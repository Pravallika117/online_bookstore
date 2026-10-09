import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
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

/** The sort orders accepted by GET /books. */
const SORTS = {
  price_asc: "price_cents ASC, id ASC",
  price_desc: "price_cents DESC, id ASC",
  title: "title COLLATE NOCASE ASC, id ASC",
  newest: "created_at DESC, id DESC",
} as const;

type SortKey = keyof typeof SORTS;

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

export const bookRoutes = (database: Database = sharedDb) =>
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
      ({ query }) => {
        const where: string[] = [];
        const params: Record<string, string | number> = {};

        if (query.search && query.search.trim().length > 0) {
          const like = `%${query.search.trim()}%`;
          where.push("(title LIKE $search OR author LIKE $search)");
          params.$search = like;
        }
        if (query.category && query.category.trim().length > 0) {
          where.push("category = $category");
          params.$category = query.category.trim();
        }
        if (query.publisher && query.publisher.trim().length > 0) {
          where.push("publisher = $publisher");
          params.$publisher = query.publisher.trim();
        }
        if (typeof query.minPrice === "number") {
          where.push("price_cents >= $minPrice");
          params.$minPrice = Math.round(query.minPrice * 100);
        }
        if (typeof query.maxPrice === "number") {
          where.push("price_cents <= $maxPrice");
          params.$maxPrice = Math.round(query.maxPrice * 100);
        }

        const whereSql =
          where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

        const sortKey: SortKey = (
          query.sort && query.sort in SORTS ? query.sort : "newest"
        ) as SortKey;
        const orderSql = SORTS[sortKey];

        const page = query.page && query.page > 0 ? query.page : 1;
        const pageSize = Math.min(
          query.pageSize && query.pageSize > 0
            ? query.pageSize
            : DEFAULT_PAGE_SIZE,
          MAX_PAGE_SIZE,
        );
        const offset = (page - 1) * pageSize;

        const totalRow = database
          .query<{ total: number }, typeof params>(
            `SELECT COUNT(*) AS total FROM books ${whereSql}`,
          )
          .get(params);
        const total = totalRow?.total ?? 0;

        const items = database
          .query<BookRow, Record<string, string | number>>(
            `SELECT * FROM books ${whereSql}
             ORDER BY ${orderSql}
             LIMIT $limit OFFSET $offset`,
          )
          .all({ ...params, $limit: pageSize, $offset: offset });

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
    .get("/categories", () => {
      const items = database
        .query<{ category: string; count: number }, []>(
          `SELECT category, COUNT(*) AS count
             FROM books
            WHERE category IS NOT NULL AND category <> ''
            GROUP BY category
            ORDER BY category COLLATE NOCASE ASC`,
        )
        .all();
      return { items };
    })
    // --- Distinct publishers with counts ----------------------------------
    .get("/publishers", () => {
      const items = database
        .query<{ publisher: string; count: number }, []>(
          `SELECT publisher, COUNT(*) AS count
             FROM books
            WHERE publisher IS NOT NULL AND publisher <> ''
            GROUP BY publisher
            ORDER BY publisher COLLATE NOCASE ASC`,
        )
        .all();
      return { items };
    })
    // --- Single book + tentative delivery date + related products ---------
    .get(
      "/books/:id",
      ({ params, set }) => {
        const book = database
          .query<BookRow, [number]>("SELECT * FROM books WHERE id = ?")
          .get(params.id);

        if (!book) {
          set.status = 404;
          return { error: "Book not found" };
        }

        const delivery = new Date();
        delivery.setUTCDate(delivery.getUTCDate() + book.delivery_lead_days);

        const relatedProducts = database
          .query<BookRow, [number, string | null, string, string | null]>(
            `SELECT * FROM books
              WHERE id <> ?
                AND (category = ? OR author = ? OR publisher = ?)
              ORDER BY rating DESC, id ASC
              LIMIT 6`,
          )
          .all(book.id, book.category, book.author, book.publisher);

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
