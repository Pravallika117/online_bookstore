import { Elysia, t } from "elysia";
import type { SQL } from "bun";
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
async function getOrCreateCartId(
  database: SQL,
  userId: number,
): Promise<number> {
  const [existing] = (await database`
    SELECT id FROM carts WHERE user_id = ${userId}
  `) as [{ id: number }?];
  if (existing) return existing.id;

  const [created] = (await database`
    INSERT INTO carts (user_id) VALUES (${userId}) RETURNING id
  `) as [{ id: number }?];
  // RETURNING guarantees a row; the ?? is only to satisfy the types.
  return created?.id ?? 0;
}

/** Build the full cart view for a cart id (items + totals). */
export async function buildCartView(
  database: SQL,
  cartId: number,
): Promise<CartView> {
  const items = (await database`
    SELECT ci.id            AS id,
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
     WHERE ci.cart_id = ${cartId}
     ORDER BY ci.id ASC
  `) as CartItemView[];

  const subtotal_cents = items.reduce((sum, i) => sum + i.line_total_cents, 0);
  const item_count = items.reduce((sum, i) => sum + i.quantity, 0);

  return { items, subtotal_cents, item_count };
}

export const cartRoutes = (database: SQL = sharedDb) =>
  new Elysia({ prefix: "/cart" })
    .onError(({ code, set }) => {
      if (code === "VALIDATION") {
        set.status = 400;
        return { error: "Invalid request body" };
      }
    })
    .use(authGuard(database))
    // --- Read the current cart --------------------------------------------
    .get("/", async ({ userId }) => {
      const cartId = await getOrCreateCartId(database, userId);
      return buildCartView(database, cartId);
    })
    // --- Add or increment an item -----------------------------------------
    .post(
      "/items",
      async ({ userId, body, set }) => {
        const cartId = await getOrCreateCartId(database, userId);

        const [book] = (await database`
          SELECT id, stock FROM books WHERE id = ${body.bookId}
        `) as [{ id: number; stock: number }?];
        if (!book) {
          set.status = 404;
          return { error: "Book not found" };
        }

        const [existing] = (await database`
          SELECT id, quantity FROM cart_items
           WHERE cart_id = ${cartId} AND book_id = ${body.bookId}
        `) as [{ id: number; quantity: number }?];

        const desiredQty = (existing?.quantity ?? 0) + body.quantity;
        if (desiredQty > book.stock) {
          set.status = 409;
          return { error: "Insufficient stock" };
        }

        if (existing) {
          await database`
            UPDATE cart_items SET quantity = ${desiredQty} WHERE id = ${existing.id}
          `;
        } else {
          await database`
            INSERT INTO cart_items (cart_id, book_id, quantity)
            VALUES (${cartId}, ${body.bookId}, ${body.quantity})
          `;
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
      async ({ userId, params, body, set }) => {
        const cartId = await getOrCreateCartId(database, userId);

        const [item] = (await database`
          SELECT id, book_id FROM cart_items
           WHERE id = ${params.id} AND cart_id = ${cartId}
        `) as [{ id: number; book_id: number }?];
        if (!item) {
          set.status = 404;
          return { error: "Cart item not found" };
        }

        if (body.quantity === 0) {
          await database`DELETE FROM cart_items WHERE id = ${item.id}`;
          return buildCartView(database, cartId);
        }

        const [book] = (await database`
          SELECT stock FROM books WHERE id = ${item.book_id}
        `) as [{ stock: number }?];
        if (book && body.quantity > book.stock) {
          set.status = 409;
          return { error: "Insufficient stock" };
        }

        await database`
          UPDATE cart_items SET quantity = ${body.quantity} WHERE id = ${item.id}
        `;
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
      async ({ userId, params, set }) => {
        const cartId = await getOrCreateCartId(database, userId);

        const [item] = (await database`
          SELECT id FROM cart_items WHERE id = ${params.id} AND cart_id = ${cartId}
        `) as [{ id: number }?];
        if (!item) {
          set.status = 404;
          return { error: "Cart item not found" };
        }

        await database`DELETE FROM cart_items WHERE id = ${item.id}`;
        return buildCartView(database, cartId);
      },
      {
        params: t.Object({ id: t.Numeric() }),
      },
    );
