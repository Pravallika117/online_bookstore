import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { initSchema } from "../db/schema";
import { seedIfEmpty } from "../db/seed";
import { authRoutes } from "./auth";
import { recommendationRoutes } from "./recommendations";
import type { BookRow } from "./books";

/**
 * Recommendation endpoint tests against an in-memory, freshly seeded
 * bun:sqlite database. Two users are registered: one with no order history
 * (expects the popular fallback) and one with a seeded order in a known
 * category (expects history-driven results that exclude purchased titles).
 */

type App = ReturnType<typeof buildApp>;

function buildApp(database: Database) {
  return new Elysia({ prefix: "/api" })
    .use(authRoutes(database))
    .use(recommendationRoutes(database));
}

let app: App;
let db: Database;

beforeAll(() => {
  db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  initSchema(db);
  seedIfEmpty(db);
  app = buildApp(db);
});

afterAll(() => {
  db.close();
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
function seedOrder(userId: number, bookId: number): void {
  const book = db
    .query<BookRow, [number]>("SELECT * FROM books WHERE id = ?")
    .get(bookId)!;

  const order = db
    .query<{ id: number }, [number, number, number]>(
      `INSERT INTO orders
         (user_id, address_snapshot, status, subtotal_cents, total_cents,
          cancellable_until)
       VALUES (?, '{}', 'paid', ?, ?, datetime('now', '+48 hours'))
       RETURNING id`,
    )
    .get(userId, book.price_cents, book.price_cents)!;

  db.run(
    `INSERT INTO order_items
       (order_id, book_id, title, author, unit_price_cents, quantity)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [order.id, book.id, book.title, book.author, book.price_cents],
  );
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
    const bought = db
      .query<BookRow, [string]>(
        "SELECT * FROM books WHERE category = ? ORDER BY id ASC LIMIT 1",
      )
      .get("Fantasy")!;
    seedOrder(id, bought.id);

    const { items, source } = await getRecommendations(token);
    expect(items.length).toBeGreaterThan(0);
    expect(source).toBe("history");

    // The purchased title must be excluded.
    expect(items.every((b) => b.id !== bought.id)).toBe(true);

    // At least one recommendation shares the purchased category.
    expect(items.some((b) => b.category === "Fantasy")).toBe(true);
  });
});
