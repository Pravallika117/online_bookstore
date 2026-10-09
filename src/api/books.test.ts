import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import type { SQL } from "bun";
import { openDb } from "../db";
import { initSchema } from "../db/schema";
import { seedIfEmpty } from "../db/seed";
import { bookRoutes, type BookRow } from "./books";

/**
 * Catalogue endpoint tests against PostgreSQL via Bun.sql. The target is
 * TEST_DATABASE_URL when set, otherwise the primary booksonline database. The
 * suite TRUNCATEs every table (RESTART IDENTITY CASCADE) before seeding so
 * book ids are deterministic (the detail test relies on books/1), and again
 * at teardown so it leaves nothing behind.
 */

type App = ReturnType<typeof buildApp>;

function buildApp(database: SQL) {
  return new Elysia({ prefix: "/api" }).use(bookRoutes(database));
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

async function getJson<T>(path: string): Promise<{ status: number; data: T }> {
  const res = await app.handle(new Request(`http://localhost${path}`));
  return { status: res.status, data: (await res.json()) as T };
}

interface ListResponse {
  items: BookRow[];
  total: number;
  page: number;
  pageSize: number;
}

describe("GET /api/books", () => {
  it("returns seeded items and a total", async () => {
    const { status, data } = await getJson<ListResponse>("/api/books");
    expect(status).toBe(200);
    expect(data.total).toBeGreaterThan(0);
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.page).toBe(1);
  });

  it("search narrows results over title and author", async () => {
    const { data } = await getJson<ListResponse>("/api/books?search=orwell");
    expect(data.items.length).toBeGreaterThan(0);
    expect(
      data.items.every(
        (b) =>
          b.title.toLowerCase().includes("orwell") ||
          b.author.toLowerCase().includes("orwell"),
      ),
    ).toBe(true);
  });

  it("filters by category", async () => {
    const { data } = await getJson<ListResponse>("/api/books?category=Fantasy");
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items.every((b) => b.category === "Fantasy")).toBe(true);
  });

  it("filters by publisher", async () => {
    const { data } = await getJson<ListResponse>(
      "/api/books?publisher=Penguin",
    );
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items.every((b) => b.publisher === "Penguin")).toBe(true);
  });

  it("filters by price range in rupees (converted to paise)", async () => {
    // 300 rupees .. 400 rupees => 30000 .. 40000 paise
    const { data } = await getJson<ListResponse>(
      "/api/books?minPrice=300&maxPrice=400",
    );
    expect(data.items.length).toBeGreaterThan(0);
    expect(
      data.items.every(
        (b) => b.price_cents >= 30000 && b.price_cents <= 40000,
      ),
    ).toBe(true);
  });

  it("sorts by price ascending", async () => {
    const { data } = await getJson<ListResponse>(
      "/api/books?sort=price_asc&pageSize=100",
    );
    const prices = data.items.map((b) => b.price_cents);
    const sorted = [...prices].sort((a, b) => a - b);
    expect(prices).toEqual(sorted);
  });

  it("sorts by price descending", async () => {
    const { data } = await getJson<ListResponse>(
      "/api/books?sort=price_desc&pageSize=100",
    );
    const prices = data.items.map((b) => b.price_cents);
    const sorted = [...prices].sort((a, b) => b - a);
    expect(prices).toEqual(sorted);
  });

  it("sorts by title", async () => {
    const { data } = await getJson<ListResponse>(
      "/api/books?sort=title&pageSize=100",
    );
    const titles = data.items.map((b) => b.title.toLowerCase());
    const sorted = [...titles].sort((a, b) => a.localeCompare(b));
    expect(titles).toEqual(sorted);
  });

  it("paginates with the right slice size", async () => {
    const first = await getJson<ListResponse>("/api/books?page=1&pageSize=5");
    expect(first.data.items.length).toBe(5);
    expect(first.data.pageSize).toBe(5);

    const second = await getJson<ListResponse>("/api/books?page=2&pageSize=5");
    expect(second.data.page).toBe(2);
    // Pages must not overlap.
    const firstIds = new Set(first.data.items.map((b) => b.id));
    expect(second.data.items.every((b) => !firstIds.has(b.id))).toBe(true);
  });
});

describe("GET /api/categories and /api/publishers", () => {
  it("returns categories with counts", async () => {
    const { status, data } = await getJson<{
      items: { category: string; count: number }[];
    }>("/api/categories");
    expect(status).toBe(200);
    expect(data.items.length).toBeGreaterThanOrEqual(1);
    expect(data.items.every((c) => c.count >= 1)).toBe(true);
  });

  it("returns publishers with counts", async () => {
    const { status, data } = await getJson<{
      items: { publisher: string; count: number }[];
    }>("/api/publishers");
    expect(status).toBe(200);
    expect(data.items.length).toBeGreaterThanOrEqual(1);
    expect(data.items.every((p) => p.count >= 1)).toBe(true);
  });
});

describe("GET /api/books/:id", () => {
  it("returns a tentative delivery date and non-empty related products", async () => {
    const { status, data } = await getJson<{
      book: BookRow;
      deliveryDate: string;
      deliveryDateDisplay: string;
      relatedProducts: BookRow[];
    }>("/api/books/1");
    expect(status).toBe(200);
    expect(data.book.id).toBe(1);
    expect(data.deliveryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof data.deliveryDateDisplay).toBe("string");
    expect(data.relatedProducts.length).toBeGreaterThan(0);
    // The book itself must never appear in its own related list.
    expect(data.relatedProducts.every((b) => b.id !== 1)).toBe(true);
  });

  it("returns 404 for an unknown id", async () => {
    const { status, data } = await getJson<{ error: string }>(
      "/api/books/999999",
    );
    expect(status).toBe(404);
    expect(typeof data.error).toBe("string");
  });
});
