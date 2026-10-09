import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { openDb } from "./index";
import { initSchema } from "./schema";
import { seedIfEmpty } from "./seed";

/**
 * Schema + seed tests against PostgreSQL via Bun.sql. The target is
 * TEST_DATABASE_URL when set, otherwise the primary booksonline database
 * (openDb() default). The suite is self-cleaning: it TRUNCATEs every table
 * (RESTART IDENTITY CASCADE) before seeding and again at teardown, so it is
 * independent of leftover rows from other suites and leaves no residue.
 */

const ALL_TABLES =
  "order_items, orders, cart_items, carts, addresses, users, books";

let db: SQL;

beforeAll(async () => {
  db = openDb(process.env.TEST_DATABASE_URL ?? undefined);
  await initSchema(db);
  await db.unsafe(`TRUNCATE ${ALL_TABLES} RESTART IDENTITY CASCADE`);
  await seedIfEmpty(db);
});

afterAll(async () => {
  await db.unsafe(`TRUNCATE ${ALL_TABLES} RESTART IDENTITY CASCADE`);
  await db.end();
});

describe("db schema + seed", () => {
  test("creates all expected tables", async () => {
    const rows = (await db`
      SELECT table_name AS name
        FROM information_schema.tables
       WHERE table_schema = 'public'
    `) as { name: string }[];
    const names = rows.map((r) => r.name);

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
  });

  test("seeds a non-empty catalogue", async () => {
    const [row] = await db`SELECT COUNT(*)::int AS count FROM books`;
    expect(Number(row!.count)).toBeGreaterThan(0);
  });

  test("spans at least 4 categories and 3 publishers", async () => {
    const [categories] =
      await db`SELECT COUNT(DISTINCT category)::int AS count FROM books`;
    const [publishers] =
      await db`SELECT COUNT(DISTINCT publisher)::int AS count FROM books`;
    expect(Number(categories!.count)).toBeGreaterThanOrEqual(4);
    expect(Number(publishers!.count)).toBeGreaterThanOrEqual(3);
  });

  test("every seeded book has a cover_url and a positive price_cents", async () => {
    const [bad] = await db`
      SELECT COUNT(*)::int AS count FROM books
       WHERE cover_url IS NULL OR cover_url = '' OR price_cents <= 0
    `;
    expect(Number(bad!.count)).toBe(0);
  });

  test("seedIfEmpty is idempotent", async () => {
    const [{ count: before }] =
      await db`SELECT COUNT(*)::int AS count FROM books`;

    // Running it again must not duplicate rows.
    await seedIfEmpty(db);
    await seedIfEmpty(db);

    const [{ count: after }] =
      await db`SELECT COUNT(*)::int AS count FROM books`;
    expect(Number(after)).toBe(Number(before));
  });
});
