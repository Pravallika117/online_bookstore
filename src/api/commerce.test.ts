import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { initSchema } from "../db/schema";
import { authRoutes } from "./auth";
import { cartRoutes } from "./cart";
import { addressRoutes } from "./addresses";
import { orderRoutes } from "./orders";

/**
 * Commerce (cart + addresses + orders) tests against an in-memory bun:sqlite
 * database so the real store.sqlite is never touched. Two users A and B are
 * registered to exercise strict per-user isolation. The checkout flow,
 * point-redemption clamping, buy-again, cancel-within-48h, and the >48h
 * server-side rejection are all covered.
 */

type App = ReturnType<typeof buildApp>;

function buildApp(database: Database) {
  return new Elysia({ prefix: "/api" })
    .use(authRoutes(database))
    .use(cartRoutes(database))
    .use(addressRoutes(database))
    .use(orderRoutes(database));
}

let app: App;
let db: Database;
let tokenA = "";
let tokenB = "";
let userAId = 0;
let bookId = 0;
let addressAId = 0;

function req(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return app.handle(new Request(`http://localhost${path}`, init));
}

const post = (p: string, token?: string, body?: unknown) =>
  req("POST", p, token, body);
const get = (p: string, token?: string) => req("GET", p, token);
const del = (p: string, token?: string) => req("DELETE", p, token);
const patch = (p: string, token?: string, body?: unknown) =>
  req("PATCH", p, token, body);

/** Insert one seed book directly so we control price/stock in assertions. */
function seedOneBook(database: Database): number {
  const row = database
    .query<{ id: number }, []>(
      `INSERT INTO books (title, author, publisher, description, price_cents,
                          category, cover_url, stock, rating, delivery_lead_days)
       VALUES ('Test Book', 'Test Author', 'Test Pub', 'desc', 50000,
               'Fiction', 'http://cover', 10, 4.5, 4)
       RETURNING id`,
    )
    .get();
  return row!.id;
}

beforeAll(async () => {
  db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  initSchema(db);
  app = buildApp(db);
  bookId = seedOneBook(db);

  const regA = await post("/api/auth/register", undefined, {
    email: "a@example.com",
    password: "supersecret",
    name: "User A",
  });
  const dataA = (await regA.json()) as { token: string; user: { id: number } };
  tokenA = dataA.token;
  userAId = dataA.user.id;

  const regB = await post("/api/auth/register", undefined, {
    email: "b@example.com",
    password: "supersecret",
    name: "User B",
  });
  const dataB = (await regB.json()) as { token: string };
  tokenB = dataB.token;

  // Give user A a known gift_points balance for redemption clamping tests.
  db.run("UPDATE users SET gift_points = 100 WHERE id = ?", [userAId]);
});

afterAll(() => {
  db.close();
});

describe("cart", () => {
  it("adds an item and reflects line totals + subtotal", async () => {
    const res = await post("/api/cart/items", tokenA, {
      bookId,
      quantity: 2,
    });
    expect(res.status).toBe(200);
    const cart = (await res.json()) as {
      items: { quantity: number; line_total_cents: number }[];
      subtotal_cents: number;
      item_count: number;
    };
    expect(cart.items.length).toBe(1);
    expect(cart.items[0]!.quantity).toBe(2);
    expect(cart.items[0]!.line_total_cents).toBe(100000);
    expect(cart.subtotal_cents).toBe(100000);
    expect(cart.item_count).toBe(2);
  });

  it("rejects quantities beyond stock (409)", async () => {
    const res = await post("/api/cart/items", tokenA, {
      bookId,
      quantity: 999,
    });
    expect(res.status).toBe(409);
  });

  it("requires auth (401 without token)", async () => {
    const res = await get("/api/cart");
    expect(res.status).toBe(401);
  });
});

describe("addresses", () => {
  it("creates an address for user A", async () => {
    const res = await post("/api/addresses", tokenA, {
      label: "Home",
      recipient: "User A",
      line1: "1 Test St",
      city: "Testville",
      state: "TS",
      postal_code: "123456",
      country: "India",
      is_default: true,
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { address: { id: number } };
    addressAId = data.address.id;
    expect(addressAId).toBeGreaterThan(0);
  });

  it("lists only user A's addresses", async () => {
    const res = await get("/api/addresses", tokenA);
    const data = (await res.json()) as { items: unknown[] };
    expect(data.items.length).toBe(1);
  });
});

describe("checkout", () => {
  it("creates a 'paid' order applying clamped redemption and earns points", async () => {
    // Cart currently holds qty 2 of the 50000-paise book = 100000 subtotal.
    // Redeem 30 points (= ₹30 = 3000 paise); balance is 100, so not clamped.
    const res = await post("/api/orders", tokenA, {
      address_id: addressAId,
      redeem_points: 30,
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as {
      order: {
        id: number;
        status: string;
        payment_method: string;
        subtotal_cents: number;
        points_redeemed: number;
        points_earned: number;
        total_cents: number;
        isCancellable: boolean;
        items: unknown[];
      };
    };
    const o = data.order;
    expect(o.status).toBe("paid");
    expect(o.payment_method).toBe("MOCK");
    expect(o.subtotal_cents).toBe(100000);
    expect(o.points_redeemed).toBe(30);
    expect(o.total_cents).toBe(97000); // 100000 - 30*100
    expect(o.points_earned).toBe(9); // floor(97000 / 10000)
    expect(o.isCancellable).toBe(true);
    expect(o.items.length).toBe(1);
  });

  it("decremented stock and cleared the cart", async () => {
    const stock = db
      .query<{ stock: number }, [number]>("SELECT stock FROM books WHERE id = ?")
      .get(bookId);
    expect(stock!.stock).toBe(8); // 10 - 2

    const cartRes = await get("/api/cart", tokenA);
    const cart = (await cartRes.json()) as { items: unknown[] };
    expect(cart.items.length).toBe(0);
  });

  it("updated user A's gift_points (−30 redeemed, +9 earned => 79)", () => {
    const row = db
      .query<{ gift_points: number }, [number]>(
        "SELECT gift_points FROM users WHERE id = ?",
      )
      .get(userAId);
    expect(row!.gift_points).toBe(79);
  });

  it("rejects checkout with an empty cart (400)", async () => {
    const res = await post("/api/orders", tokenA, { address_id: addressAId });
    expect(res.status).toBe(400);
  });

  it("rejects an address that is not owned (404)", async () => {
    // Put something in the cart first.
    await post("/api/cart/items", tokenA, { bookId, quantity: 1 });
    const res = await post("/api/orders", tokenA, { address_id: 99999 });
    expect(res.status).toBe(404);
    // Clean the cart back out for later tests.
    const cart = (await (await get("/api/cart", tokenA)).json()) as {
      items: { id: number }[];
    };
    for (const i of cart.items) await del(`/api/cart/items/${i.id}`, tokenA);
  });

  it("clamps redeem_points above balance and never produces a negative total", async () => {
    // Fresh order: add 1 unit (50000 paise), redeem 100000 points (way over).
    await post("/api/cart/items", tokenA, { bookId, quantity: 1 });
    const res = await post("/api/orders", tokenA, {
      address_id: addressAId,
      redeem_points: 100000,
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as {
      order: { total_cents: number; points_redeemed: number };
    };
    // Clamped to balance (79) and subtotal-in-points (500); min is 79.
    expect(data.order.points_redeemed).toBe(79);
    expect(data.order.total_cents).toBe(50000 - 79 * 100);
    expect(data.order.total_cents).toBeGreaterThanOrEqual(0);
  });
});

describe("order history, buy-again, cancel", () => {
  let orderId = 0;

  it("lists orders newest first with isCancellable", async () => {
    const res = await get("/api/orders", tokenA);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      orders: { id: number; isCancellable: boolean }[];
    };
    expect(data.orders.length).toBeGreaterThanOrEqual(2);
    orderId = data.orders[0]!.id;
    expect(data.orders[0]!.isCancellable).toBe(true);
  });

  it("buy-again re-adds the order's books to the cart", async () => {
    const res = await post(`/api/orders/${orderId}/buy-again`, tokenA);
    expect(res.status).toBe(200);
    const cart = (await res.json()) as { items: unknown[] };
    expect(cart.items.length).toBeGreaterThan(0);
    // Clear the cart afterwards.
    const current = (await (await get("/api/cart", tokenA)).json()) as {
      items: { id: number }[];
    };
    for (const i of current.items) await del(`/api/cart/items/${i.id}`, tokenA);
  });

  it("cancels within the window: restores stock and refunds points", async () => {
    const before = db
      .query<{ stock: number }, [number]>("SELECT stock FROM books WHERE id = ?")
      .get(bookId)!.stock;
    const order = db
      .query<
        { points_redeemed: number; points_earned: number; quantity: number },
        [number]
      >(
        `SELECT o.points_redeemed, o.points_earned,
                (SELECT SUM(quantity) FROM order_items WHERE order_id = o.id) AS quantity
           FROM orders o WHERE o.id = ?`,
      )
      .get(orderId)!;
    const pointsBefore = db
      .query<{ gift_points: number }, [number]>(
        "SELECT gift_points FROM users WHERE id = ?",
      )
      .get(userAId)!.gift_points;

    const res = await post(`/api/orders/${orderId}/cancel`, tokenA);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { order: { status: string } };
    expect(data.order.status).toBe("cancelled");

    const after = db
      .query<{ stock: number }, [number]>("SELECT stock FROM books WHERE id = ?")
      .get(bookId)!.stock;
    expect(after).toBe(before + order.quantity);

    const pointsAfter = db
      .query<{ gift_points: number }, [number]>(
        "SELECT gift_points FROM users WHERE id = ?",
      )
      .get(userAId)!.gift_points;
    expect(pointsAfter).toBe(
      pointsBefore + order.points_redeemed - order.points_earned,
    );
  });

  it("rejects cancelling an order older than 48h server-side (403)", async () => {
    // Build a paid order for A with placed_at + cancellable_until in the past.
    const past = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const pastEnd = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const stale = db
      .query<{ id: number }, [number, string, string]>(
        `INSERT INTO orders
           (user_id, address_snapshot, status, payment_method,
            subtotal_cents, points_redeemed, points_earned, total_cents,
            placed_at, cancellable_until)
         VALUES (?, '{}', 'paid', 'MOCK', 50000, 0, 5, 50000, ?, ?)
         RETURNING id`,
      )
      .get(userAId, past, pastEnd)!;

    const res = await post(`/api/orders/${stale.id}/cancel`, tokenA);
    expect(res.status).toBe(403);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe("Cancellation window expired");

    // The order must remain 'paid'.
    const status = db
      .query<{ status: string }, [number]>(
        "SELECT status FROM orders WHERE id = ?",
      )
      .get(stale.id)!.status;
    expect(status).toBe("paid");
  });
});

describe("cross-user isolation", () => {
  let aOrderId = 0;

  it("sets up: user A has at least one order", async () => {
    const res = await get("/api/orders", tokenA);
    const data = (await res.json()) as { orders: { id: number }[] };
    aOrderId = data.orders[0]!.id;
    expect(aOrderId).toBeGreaterThan(0);
  });

  it("user B sees an empty cart and no orders/addresses", async () => {
    const cart = (await (await get("/api/cart", tokenB)).json()) as {
      items: unknown[];
    };
    expect(cart.items.length).toBe(0);

    const orders = (await (await get("/api/orders", tokenB)).json()) as {
      orders: unknown[];
    };
    expect(orders.orders.length).toBe(0);

    const addrs = (await (await get("/api/addresses", tokenB)).json()) as {
      items: unknown[];
    };
    expect(addrs.items.length).toBe(0);
  });

  it("user B cannot read user A's order (404)", async () => {
    const res = await get(`/api/orders/${aOrderId}`, tokenB);
    expect(res.status).toBe(404);
  });

  it("user B cannot cancel user A's order (404)", async () => {
    const res = await post(`/api/orders/${aOrderId}/cancel`, tokenB);
    expect(res.status).toBe(404);
  });

  it("user B cannot buy-again user A's order (404)", async () => {
    const res = await post(`/api/orders/${aOrderId}/buy-again`, tokenB);
    expect(res.status).toBe(404);
  });

  it("user B cannot patch/delete user A's address (404)", async () => {
    const patchRes = await patch(`/api/addresses/${addressAId}`, tokenB, {
      city: "Hacked",
    });
    expect(patchRes.status).toBe(404);
    const delRes = await del(`/api/addresses/${addressAId}`, tokenB);
    expect(delRes.status).toBe(404);
  });
});
