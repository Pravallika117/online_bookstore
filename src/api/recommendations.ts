import { Elysia } from "elysia";
import type { SQL } from "bun";
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
async function popularFallback(
  database: SQL,
  excludeIds: number[],
): Promise<BookRow[]> {
  if (excludeIds.length === 0) {
    return (await database`
      SELECT * FROM books
       WHERE stock > 0
       ORDER BY rating DESC, id ASC
       LIMIT ${LIMIT}
    `) as BookRow[];
  }
  return (await database`
    SELECT * FROM books
     WHERE stock > 0
       AND id NOT IN ${database(excludeIds)}
     ORDER BY rating DESC, id ASC
     LIMIT ${LIMIT}
  `) as BookRow[];
}

export const recommendationRoutes = (database: SQL = sharedDb) =>
  new Elysia()
    .use(authGuard(database))
    .get("/recommendations", async ({ userId }) => {
      // Book ids the user has already purchased (any non-cancelled order).
      const purchasedIdRows = (await database`
        SELECT DISTINCT oi.book_id
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
         WHERE o.user_id = ${userId} AND o.status <> 'cancelled'
      `) as { book_id: number }[];
      const purchasedIds = purchasedIdRows.map((r) => r.book_id);

      // The facets (category/author/publisher) of what they've bought.
      const facetRows = (await database`
        SELECT DISTINCT b.category, b.author, b.publisher
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          JOIN books b  ON b.id = oi.book_id
         WHERE o.user_id = ${userId} AND o.status <> 'cancelled'
      `) as {
        category: string | null;
        author: string;
        publisher: string | null;
      }[];

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
        // Compose the facet match as OR-ed parameterised IN fragments; each
        // value set is bound via database(array), never string-interpolated.
        const clauses: SQL.Query<unknown>[] = [];
        if (categories.size > 0) {
          clauses.push(database`category IN ${database([...categories])}`);
        }
        if (authors.size > 0) {
          clauses.push(database`author IN ${database([...authors])}`);
        }
        if (publishers.size > 0) {
          clauses.push(database`publisher IN ${database([...publishers])}`);
        }
        const facetSql = clauses.reduce((acc, c, i) =>
          i === 0 ? c : database`${acc} OR ${c}`,
        );

        const excludeSql =
          purchasedIds.length > 0
            ? database`AND id NOT IN ${database(purchasedIds)}`
            : database``;

        items = (await database`
          SELECT * FROM books
           WHERE stock > 0
             AND (${facetSql})
             ${excludeSql}
           ORDER BY rating DESC, id ASC
           LIMIT ${LIMIT}
        `) as BookRow[];

        if (items.length > 0) source = "history";
      }

      // Fallback (no history, or history produced nothing new to suggest).
      if (items.length === 0) {
        items = await popularFallback(database, purchasedIds);
        source = "popular";
      }

      return { items, source };
    });
