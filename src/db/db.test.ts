import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "./schema";
import { seedIfEmpty } from "./seed";

/** Spin up a throwaway in-memory DB with schema + seed applied. */
function freshSeededDb(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  initSchema(db);
  seedIfEmpty(db);
  return db;
}

describe("db schema + seed", () => {
  test("creates all expected tables", () => {
    const db = freshSeededDb();
    const names = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      )
      .all()
      .map((r) => r.name);

    for (const table of [
      "users",
      "books",
      "addresses",
      "carts",
      "cart_items",
      "orders",
      "order_items",
    ]) {
      expect(names).toContain(table);
    }
    db.close();
  });

  test("seeds a non-empty catalogue", () => {
    const db = freshSeededDb();
    const row = db
      .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM books")
      .get();
    expect(row!.count).toBeGreaterThan(0);
    db.close();
  });

  test("spans at least 4 categories and 3 publishers", () => {
    const db = freshSeededDb();
    const categories = db
      .query<{ count: number }, []>(
        "SELECT COUNT(DISTINCT category) AS count FROM books",
      )
      .get();
    const publishers = db
      .query<{ count: number }, []>(
        "SELECT COUNT(DISTINCT publisher) AS count FROM books",
      )
      .get();
    expect(categories!.count).toBeGreaterThanOrEqual(4);
    expect(publishers!.count).toBeGreaterThanOrEqual(3);
    db.close();
  });

  test("every seeded book has a cover_url and a positive price_cents", () => {
    const db = freshSeededDb();
    const bad = db
      .query<{ count: number }, []>(
        `SELECT COUNT(*) AS count FROM books
         WHERE cover_url IS NULL OR cover_url = '' OR price_cents <= 0`,
      )
      .get();
    expect(bad!.count).toBe(0);
    db.close();
  });

  test("seedIfEmpty is idempotent", () => {
    const db = freshSeededDb();
    const before = db
      .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM books")
      .get()!.count;

    // Running it again must not duplicate rows.
    seedIfEmpty(db);
    seedIfEmpty(db);

    const after = db
      .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM books")
      .get()!.count;
    expect(after).toBe(before);
    db.close();
  });
});
