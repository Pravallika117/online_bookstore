import { Elysia, t } from "elysia";
import type { SQL } from "bun";
import { db as sharedDb } from "../db";

/**
 * Public catalogue routes mounted under /api:
 *   GET /books              listing with search/filter/sort/pagination
 *   GET /categories         distinct categories with book counts
 *   GET /publishers         distinct publishers with book counts
 *   GET /books/:id          single book + tentative delivery date + related
 *
 * These are all public (no auth guard). Money is stored as integer paise in
 * price_cents; the minPrice/maxPrice query params are given in whole rupees
 * and converted to paise before filtering. Every query that incorporates
 * user input uses bound parameters (prepared statements) — user input is
 * never string-interpolated into SQL.
 */

/** The row shape persisted in the books table. */
export interface BookRow {
  id: number;
  title: string;
  author: string;
  publisher: string | null;
  description: string | null;
  price_cents: number;
  category: string | null;
  cover_url: string | null;
  stock: number;
  rating: number;
  delivery_lead_days: number;
  created_at: string;
}

/** Default / maximum page sizes for the listing endpoint. */
const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 100;

/**
 * The sort orders accepted by GET /books, as Bun.sql ORDER BY fragments. The
 * key is chosen from a fixed allowlist (never user input), so interpolating
 * the chosen fragment is safe. Case-insensitive title sort uses LOWER(title)
 * (Postgres LIKE/ORDER BY are case-sensitive, unlike SQLite's NOCASE).
 */
const SORT_KEYS = ["price_asc", "price_desc", "title", "newest"] as const;
type SortKey = (typeof SORT_KEYS)[number];

function orderByFragment(database: SQL, key: SortKey) {
  switch (key) {
    case "price_asc":
      return database`price_cents ASC, id ASC`;
    case "price_desc":
      return database`price_cents DESC, id ASC`;
    case "title":
      return database`LOWER(title) ASC, id ASC`;
    case "newest":
    default:
      return database`created_at DESC, id DESC`;
  }
}

/** Format a Date as a YYYY-MM-DD calendar day in UTC. */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Human-friendly display form, e.g. "Mon, 05 May 2025". */
function toDisplayDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export const bookRoutes = (database: SQL = sharedDb) =>
  new Elysia()
    .onError(({ code, set }) => {
      if (code === "VALIDATION") {
        set.status = 400;
        return { error: "Invalid query parameters" };
      }
    })
    // --- Listing with search / filter / sort / pagination -----------------
    .get(
      "/books",
      async ({ query }) => {
        // Build the WHERE clause from parameterised Bun.sql fragments. User
        // input is only ever bound (${...}), never string-interpolated. ILIKE
        // gives case-insensitive title/author search (SQLite LIKE was already
        // case-insensitive; Postgres LIKE is not).
        const conds: SQL.Query<unknown>[] = [];

        if (query.search && query.search.trim().length > 0) {
          const like = `%${query.search.trim()}%`;
          conds.push(database`(title ILIKE ${like} OR author ILIKE ${like})`);
        }
        if (query.category && query.category.trim().length > 0) {
          conds.push(database`category = ${query.category.trim()}`);
        }
        if (query.publisher && query.publisher.trim().length > 0) {
          conds.push(database`publisher = ${query.publisher.trim()}`);
        }
        if (typeof query.minPrice === "number") {
          conds.push(database`price_cents >= ${Math.round(query.minPrice * 100)}`);
        }
        if (typeof query.maxPrice === "number") {
          conds.push(database`price_cents <= ${Math.round(query.maxPrice * 100)}`);
        }

        const whereSql = conds.length
          ? conds.reduce(
              (acc, c, i) => (i === 0 ? database`WHERE ${c}` : database`${acc} AND ${c}`),
              database``,
            )
          : database``;

        const sortKey: SortKey = (
          query.sort && SORT_KEYS.includes(query.sort as SortKey)
            ? query.sort
            : "newest"
        ) as SortKey;
        const orderSql = orderByFragment(database, sortKey);

        const page = query.page && query.page > 0 ? query.page : 1;
        const pageSize = Math.min(
          query.pageSize && query.pageSize > 0
            ? query.pageSize
            : DEFAULT_PAGE_SIZE,
          MAX_PAGE_SIZE,
        );
        const offset = (page - 1) * pageSize;

        const [totalRow] = await database`
          SELECT COUNT(*)::int AS total FROM books ${whereSql}
        `;
        const total = Number(totalRow?.total ?? 0);

        const items = (await database`
          SELECT * FROM books ${whereSql}
          ORDER BY ${orderSql}
          LIMIT ${pageSize} OFFSET ${offset}
        `) as BookRow[];

        return { items, total, page, pageSize };
      },
      {
        query: t.Object({
          search: t.Optional(t.String()),
          category: t.Optional(t.String()),
          publisher: t.Optional(t.String()),
          minPrice: t.Optional(t.Numeric({ minimum: 0 })),
          maxPrice: t.Optional(t.Numeric({ minimum: 0 })),
          sort: t.Optional(
            t.Union([
              t.Literal("price_asc"),
              t.Literal("price_desc"),
              t.Literal("title"),
              t.Literal("newest"),
            ]),
          ),
          page: t.Optional(t.Numeric({ minimum: 1 })),
          pageSize: t.Optional(t.Numeric({ minimum: 1 })),
        }),
      },
    )
    // --- Distinct categories with counts ----------------------------------
    .get("/categories", async () => {
      const rows = (await database`
        SELECT category, COUNT(*)::int AS count
          FROM books
         WHERE category IS NOT NULL AND category <> ''
         GROUP BY category
         ORDER BY LOWER(category) ASC
      `) as { category: string; count: number }[];
      const items = rows.map((r) => ({
        category: r.category,
        count: Number(r.count),
      }));
      return { items };
    })
    // --- Distinct publishers with counts ----------------------------------
    .get("/publishers", async () => {
      const rows = (await database`
        SELECT publisher, COUNT(*)::int AS count
          FROM books
         WHERE publisher IS NOT NULL AND publisher <> ''
         GROUP BY publisher
         ORDER BY LOWER(publisher) ASC
      `) as { publisher: string; count: number }[];
      const items = rows.map((r) => ({
        publisher: r.publisher,
        count: Number(r.count),
      }));
      return { items };
    })
    // --- Single book + tentative delivery date + related products ---------
    .get(
      "/books/:id",
      async ({ params, set }) => {
        const [book] = (await database`
          SELECT * FROM books WHERE id = ${params.id}
        `) as [BookRow?];

        if (!book) {
          set.status = 404;
          return { error: "Book not found" };
        }

        const delivery = new Date();
        delivery.setUTCDate(delivery.getUTCDate() + book.delivery_lead_days);

        const relatedProducts = (await database`
          SELECT * FROM books
           WHERE id <> ${book.id}
             AND (category = ${book.category}
                  OR author = ${book.author}
                  OR publisher = ${book.publisher})
           ORDER BY rating DESC, id ASC
           LIMIT 6
        `) as BookRow[];

        return {
          book,
          deliveryDate: toIsoDate(delivery),
          deliveryDateDisplay: toDisplayDate(delivery),
          relatedProducts,
        };
      },
      {
        params: t.Object({ id: t.Numeric() }),
      },
    );
