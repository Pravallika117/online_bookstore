import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { db as sharedDb } from "../db";
import { authGuard } from "../lib/auth";
import type { BookRow } from "./books";

/**
 * Personalised recommendations mounted under /api:
 *   GET /recommendations   (auth) history-driven picks with a popular fallback
 *
 * Protected by the shared authGuard (see FEAT-003 findings): the guard is a
 * factory and the module injects its own db instance so tests can supply a
 * temp DB. Downstream handlers receive { userId } resolved from the Bearer
 * JWT — every query is scoped by that id, never trusting the client.
 *
 * Strategy:
 *   1. Collect the categories/authors/publishers the user has bought from
 *      their paid-or-pending orders (via order_items).
 *   2. Recommend in-stock books that match any of those facets, EXCLUDING
 *      titles the user already owns, ordered by rating then popularity.
 *   3. If the user has no history (or the match set is empty), fall back to
 *      the top-rated in-stock catalogue. Always returns a non-empty list
 *      when the catalogue has books.
 */

const LIMIT = 8;

/** Top-rated, in-stock books — the popular fallback. */
function popularFallback(database: Database, excludeIds: number[]): BookRow[] {
  if (excludeIds.length === 0) {
    return database
      .query<BookRow, [number]>(
        `SELECT * FROM books
          WHERE stock > 0
          ORDER BY rating DESC, id ASC
          LIMIT ?`,
      )
      .all(LIMIT);
  }
  const placeholders = excludeIds.map(() => "?").join(", ");
  return database
    .query<BookRow, (number | number)[]>(
      `SELECT * FROM books
        WHERE stock > 0
          AND id NOT IN (${placeholders})
        ORDER BY rating DESC, id ASC
        LIMIT ?`,
    )
    .all(...excludeIds, LIMIT);
}

export const recommendationRoutes = (database: Database = sharedDb) =>
  new Elysia()
    .use(authGuard(database))
    .get("/recommendations", ({ userId }) => {
      // Book ids the user has already purchased (any non-cancelled order).
      const purchasedIdRows = database
        .query<{ book_id: number }, [number]>(
          `SELECT DISTINCT oi.book_id
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
            WHERE o.user_id = ? AND o.status <> 'cancelled'`,
        )
        .all(userId);
      const purchasedIds = purchasedIdRows.map((r) => r.book_id);

      // The facets (category/author/publisher) of what they've bought.
      const facetRows = database
        .query<
          { category: string | null; author: string; publisher: string | null },
          [number]
        >(
          `SELECT DISTINCT b.category, b.author, b.publisher
             FROM order_items oi
             JOIN orders o ON o.id = oi.order_id
             JOIN books b  ON b.id = oi.book_id
            WHERE o.user_id = ? AND o.status <> 'cancelled'`,
        )
        .all(userId);

      const categories = new Set<string>();
      const authors = new Set<string>();
      const publishers = new Set<string>();
      for (const f of facetRows) {
        if (f.category) categories.add(f.category);
        if (f.author) authors.add(f.author);
        if (f.publisher) publishers.add(f.publisher);
      }

      let items: BookRow[] = [];
      let source: "history" | "popular" = "popular";

      if (categories.size + authors.size + publishers.size > 0) {
        const clauses: string[] = [];
        const bind: (string | number)[] = [];

        if (categories.size > 0) {
          const ph = [...categories].map(() => "?").join(", ");
          clauses.push(`category IN (${ph})`);
          bind.push(...categories);
        }
        if (authors.size > 0) {
          const ph = [...authors].map(() => "?").join(", ");
          clauses.push(`author IN (${ph})`);
          bind.push(...authors);
        }
        if (publishers.size > 0) {
          const ph = [...publishers].map(() => "?").join(", ");
          clauses.push(`publisher IN (${ph})`);
          bind.push(...publishers);
        }

        const excludeSql =
          purchasedIds.length > 0
            ? `AND id NOT IN (${purchasedIds.map(() => "?").join(", ")})`
            : "";

        items = database
          .query<BookRow, (string | number)[]>(
            `SELECT * FROM books
              WHERE stock > 0
                AND (${clauses.join(" OR ")})
                ${excludeSql}
              ORDER BY rating DESC, id ASC
              LIMIT ?`,
          )
          .all(...bind, ...purchasedIds, LIMIT);

        if (items.length > 0) source = "history";
      }

      // Fallback (no history, or history produced nothing new to suggest).
      if (items.length === 0) {
        items = popularFallback(database, purchasedIds);
        source = "popular";
      }

      return { items, source };
    });
