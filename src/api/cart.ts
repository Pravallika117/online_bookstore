import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
import { db as sharedDb } from "../db";
import { authGuard } from "../lib/auth";

/**
 * Authenticated per-user cart routes mounted under /api/cart. Every route is
 * guarded by the shared authGuard (FEAT-003) and scoped to the authenticated
 * user's single cart row — never to any id supplied by the client. The cart
 * row is created lazily if the user somehow has none (register normally
 * provisions it).
 *
 *   GET    /cart              items joined to books, line totals, subtotal
 *   POST   /cart/items        add or increment { bookId, quantity }
 *   PATCH  /cart/items/:id    set quantity (0 removes); 404 if not owned
 *   DELETE /cart/items/:id    remove; 404 if not owned
 *
 * Money convention: all *_cents values are INTEGER paise (₹1 = 100 paise).
 */

/** A cart line enriched with the book snapshot and computed totals. */
export interface CartItemView {
  id: number;
  book_id: number;
  title: string;
  author: string;
  cover_url: string | null;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
  stock: number;
}

export interface CartView {
  items: CartItemView[];
  subtotal_cents: number;
  item_count: number;
}

/** Resolve (creating if absent) the id of the authenticated user's cart. */
function getOrCreateCartId(database: Database, userId: number): number {
  const existing = database
    .query<{ id: number }, [number]>(
      "SELECT id FROM carts WHERE user_id = ?",
    )
    .get(userId);
  if (existing) return existing.id;

  const created = database
    .query<{ id: number }, [number]>(
      "INSERT INTO carts (user_id) VALUES (?) RETURNING id",
    )
    .get(userId);
  // RETURNING guarantees a row; the ?? is only to satisfy the types.
  return created?.id ?? 0;
}

/** Build the full cart view for a cart id (items + totals). */
export function buildCartView(database: Database, cartId: number): CartView {
  const items = database
    .query<CartItemView, [number]>(
      `SELECT ci.id            AS id,
              ci.book_id       AS book_id,
              b.title          AS title,
              b.author         AS author,
              b.cover_url      AS cover_url,
              b.price_cents    AS unit_price_cents,
              ci.quantity      AS quantity,
              b.price_cents * ci.quantity AS line_total_cents,
              b.stock          AS stock
         FROM cart_items ci
         JOIN books b ON b.id = ci.book_id
        WHERE ci.cart_id = ?
        ORDER BY ci.id ASC`,
    )
    .all(cartId);

  const subtotal_cents = items.reduce((sum, i) => sum + i.line_total_cents, 0);
  const item_count = items.reduce((sum, i) => sum + i.quantity, 0);

  return { items, subtotal_cents, item_count };
}

export const cartRoutes = (database: Database = sharedDb) =>
  new Elysia({ prefix: "/cart" })
    .onError(({ code, set }) => {
      if (code === "VALIDATION") {
        set.status = 400;
        return { error: "Invalid request body" };
      }
    })
    .use(authGuard(database))
    // --- Read the current cart --------------------------------------------
    .get("/", ({ userId }) => {
      const cartId = getOrCreateCartId(database, userId);
      return buildCartView(database, cartId);
    })
    // --- Add or increment an item -----------------------------------------
    .post(
      "/items",
      ({ userId, body, set }) => {
        const cartId = getOrCreateCartId(database, userId);

        const book = database
          .query<{ id: number; stock: number }, [number]>(
            "SELECT id, stock FROM books WHERE id = ?",
          )
          .get(body.bookId);
        if (!book) {
          set.status = 404;
          return { error: "Book not found" };
        }

        const existing = database
          .query<{ id: number; quantity: number }, [number, number]>(
            "SELECT id, quantity FROM cart_items WHERE cart_id = ? AND book_id = ?",
          )
          .get(cartId, body.bookId);

        const desiredQty = (existing?.quantity ?? 0) + body.quantity;
        if (desiredQty > book.stock) {
          set.status = 409;
          return { error: "Insufficient stock" };
        }

        if (existing) {
          database.run("UPDATE cart_items SET quantity = ? WHERE id = ?", [
            desiredQty,
            existing.id,
          ]);
        } else {
          database.run(
            "INSERT INTO cart_items (cart_id, book_id, quantity) VALUES (?, ?, ?)",
            [cartId, body.bookId, body.quantity],
          );
        }

        return buildCartView(database, cartId);
      },
      {
        body: t.Object({
          bookId: t.Integer({ minimum: 1 }),
          quantity: t.Integer({ minimum: 1 }),
        }),
      },
    )
    // --- Update a line quantity (0 removes) -------------------------------
    .patch(
      "/items/:id",
      ({ userId, params, body, set }) => {
        const cartId = getOrCreateCartId(database, userId);

        const item = database
          .query<{ id: number; book_id: number }, [number, number]>(
            "SELECT id, book_id FROM cart_items WHERE id = ? AND cart_id = ?",
          )
          .get(params.id, cartId);
        if (!item) {
          set.status = 404;
          return { error: "Cart item not found" };
        }

        if (body.quantity === 0) {
          database.run("DELETE FROM cart_items WHERE id = ?", [item.id]);
          return buildCartView(database, cartId);
        }

        const book = database
          .query<{ stock: number }, [number]>(
            "SELECT stock FROM books WHERE id = ?",
          )
          .get(item.book_id);
        if (book && body.quantity > book.stock) {
          set.status = 409;
          return { error: "Insufficient stock" };
        }

        database.run("UPDATE cart_items SET quantity = ? WHERE id = ?", [
          body.quantity,
          item.id,
        ]);
        return buildCartView(database, cartId);
      },
      {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({ quantity: t.Integer({ minimum: 0 }) }),
      },
    )
    // --- Remove a line ----------------------------------------------------
    .delete(
      "/items/:id",
      ({ userId, params, set }) => {
        const cartId = getOrCreateCartId(database, userId);

        const item = database
          .query<{ id: number }, [number, number]>(
            "SELECT id FROM cart_items WHERE id = ? AND cart_id = ?",
          )
          .get(params.id, cartId);
        if (!item) {
          set.status = 404;
          return { error: "Cart item not found" };
        }

        database.run("DELETE FROM cart_items WHERE id = ?", [item.id]);
        return buildCartView(database, cartId);
      },
      {
        params: t.Object({ id: t.Numeric() }),
      },
    );
