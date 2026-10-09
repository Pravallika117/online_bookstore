import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import type { SQL } from "bun";
import { openDb } from "../db";
import { initSchema } from "../db/schema";
import { seedIfEmpty } from "../db/seed";
import { authRoutes } from "./auth";
import { recommendationRoutes } from "./recommendations";
import type { BookRow } from "./books";

/**
 * Recommendation endpoint tests against PostgreSQL via Bun.sql. The target is
 * TEST_DATABASE_URL when set, otherwise the primary booksonline database. Two
 * users are registered: one with no order history (expects the popular
 * fallback) and one with a seeded order in a known category (expects
 * history-driven results that exclude purchased titles). TRUNCATE RESTART
 * IDENTITY CASCADE keeps ids deterministic and isolates the suite.
 */

type App = ReturnType<typeof buildApp>;

function buildApp(database: SQL) {
  return new Elysia({ prefix: "/api" })
    .use(authRoutes(database))
    .use(recommendationRoutes(database));
}

const ALL_TABLES =
  "order_items, orders, cart_items, carts, addresses, users, books";

let app: App;
let db: SQL;

beforeAll(async () => {
  db = openDb(process.env.TEST_DATABASE_URL ?? undefined);
  await initSchema(db);
  await db.unsafe(`TRUNCATE ${ALL_TABLES} RESTART IDENTITY CASCADE`);
  await seedIfEmpty(db);
  app = buildApp(db);
});

afterAll(async () => {
  await db.unsafe(`TRUNCATE ${ALL_TABLES} RESTART IDENTITY CASCADE`);
  await db.end();
});

async function register(email: string): Promise<{ token: string; id: number }> {
  const res = await app.handle(
    new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "supersecret", name: "Tester" }),
    }),
  );
  const data = (await res.json()) as { token: string; user: { id: number } };
  return { token: data.token, id: data.user.id };
}

async function getRecommendations(
  token: string,
): Promise<{ items: BookRow[]; source: string }> {
  const res = await app.handle(
    new Request("http://localhost/api/recommendations", {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
  return (await res.json()) as { items: BookRow[]; source: string };
}

/** Insert a paid order for `userId` containing a single `bookId`. */
async function seedOrder(userId: number, bookId: number): Promise<void> {
  const [book] = (await db`SELECT * FROM books WHERE id = ${bookId}`) as [
    BookRow,
  ];

  // cancellable_until 48h in the future, computed in JS (no SQLite datetime()).
  const cancellableUntil = new Date(
    Date.now() + 48 * 60 * 60 * 1000,
  ).toISOString();

  const [order] = (await db`
    INSERT INTO orders
      (user_id, address_snapshot, status, subtotal_cents, total_cents,
       cancellable_until)
    VALUES (${userId}, '{}', 'paid', ${book.price_cents}, ${book.price_cents},
            ${cancellableUntil})
    RETURNING id
  `) as [{ id: number }];

  await db`
    INSERT INTO order_items
      (order_id, book_id, title, author, unit_price_cents, quantity)
    VALUES (${order.id}, ${book.id}, ${book.title}, ${book.author},
            ${book.price_cents}, 1)
  `;
}

describe("GET /api/recommendations", () => {
  it("requires authentication (401 without a token)", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/recommendations"),
    );
    expect(res.status).toBe(401);
  });

  it("returns a non-empty popular fallback for a user with no orders", async () => {
    const { token } = await register("nohistory@example.com");
    const { items, source } = await getRecommendations(token);
    expect(items.length).toBeGreaterThan(0);
    expect(source).toBe("popular");
  });

  it("favors the purchased category and excludes already-bought titles", async () => {
    const { token, id } = await register("buyer@example.com");

    // Buy a Fantasy book (The Hobbit, id 5 per the seed order).
    const [bought] = (await db`
      SELECT * FROM books WHERE category = ${"Fantasy"} ORDER BY id ASC LIMIT 1
    `) as [BookRow];
    await seedOrder(id, bought.id);

    const { items, source } = await getRecommendations(token);
    expect(items.length).toBeGreaterThan(0);
    expect(source).toBe("history");

    // The purchased title must be excluded.
    expect(items.every((b) => b.id !== bought.id)).toBe(true);

    // At least one recommendation shares the purchased category.
    expect(items.some((b) => b.category === "Fantasy")).toBe(true);
  });
});
