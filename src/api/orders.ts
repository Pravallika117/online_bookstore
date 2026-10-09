import { Elysia, t } from "elysia";
import type { SQL } from "bun";
import { db as sharedDb } from "../db";
import { authGuard } from "../lib/auth";
import { buildCartView } from "./cart";
import type { AddressRow } from "./addresses";

/**
 * Authenticated order routes mounted under /api/orders. Every route is
 * guarded (FEAT-003) and strictly scoped to the authenticated user; another
 * user's order resolves to 404.
 *
 *   POST /orders              checkout the cart (MOCKED payment -> 'paid')
 *   GET  /orders              list the user's orders (newest first)
 *   GET  /orders/:id          single owned order (404 if not owned)
 *   POST /orders/:id/cancel   cancel within 48h (server-enforced window)
 *   POST /orders/:id/buy-again  re-add the order's books to the cart
 *
 * Payment is fully mocked: no gateway, no payment-method selection. On
 * checkout the order is created with status 'paid' and payment_method 'MOCK'.
 *
 * Money / points conventions (documented for FEAT-006):
 *   - All *_cents values are INTEGER paise (₹1 = 100 paise).
 *   - Redemption: 1 gift point = ₹1 = 100 paise off the subtotal. Redeemed
 *     points are clamped server-side to BOTH the user's balance and the
 *     subtotal in points, so total_cents can never go negative.
 *   - Earning: 1 point per ₹100 actually paid, i.e.
 *     floor(total_cents / 10000). Welcome balance is 0 (set by FEAT-003
 *     register); points accrue purely from purchases.
 */

/** 1 gift point redeems this many paise off the subtotal (₹1). */
export const PAISE_PER_POINT = 100;
/** Paise that must be paid to earn 1 point (₹100). */
export const PAISE_PER_EARNED_POINT = 10000;

export interface OrderRow {
  id: number;
  user_id: number;
  address_snapshot: string;
  status: "pending" | "paid" | "cancelled";
  payment_method: string;
  subtotal_cents: number;
  points_redeemed: number;
  points_earned: number;
  total_cents: number;
  placed_at: string;
  cancellable_until: string;
}

export interface OrderItemRow {
  id: number;
  order_id: number;
  book_id: number;
  title: string;
  author: string;
  unit_price_cents: number;
  quantity: number;
}

/** Shape returned to clients: the order row with its items and a flag. */
export interface OrderView extends Omit<OrderRow, "address_snapshot"> {
  address: unknown;
  items: OrderItemRow[];
  isCancellable: boolean;
}

/**
 * placed_at / cancellable_until are stored as ISO-8601 strings (the exact
 * value the checkout inserts via new Date().toISOString()). Parse to epoch
 * ms. A bare "YYYY-MM-DD HH:MM:SS" (e.g. a now()::text default) is treated as
 * UTC. Returns NaN for unparseable input (treated as expired by callers).
 */
function parseSqlTime(value: string): number {
  // Already ISO with timezone?
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(value)) return Date.parse(value);
  // Bare "YYYY-MM-DD HH:MM:SS" -> treat as UTC.
  return Date.parse(value.replace(" ", "T") + "Z");
}

/** Assemble an OrderView from a stored order row. */
async function toOrderView(database: SQL, order: OrderRow): Promise<OrderView> {
  const items = (await database`
    SELECT * FROM order_items WHERE order_id = ${order.id} ORDER BY id ASC
  `) as OrderItemRow[];

  let address: unknown = null;
  try {
    address = JSON.parse(order.address_snapshot);
  } catch {
    address = null;
  }

  const isCancellable =
    order.status === "paid" && Date.now() < parseSqlTime(order.cancellable_until);

  const { address_snapshot: _snapshot, ...rest } = order;
  return { ...rest, address, items, isCancellable };
}

export const orderRoutes = (database: SQL = sharedDb) =>
  new Elysia({ prefix: "/orders" })
    .onError(({ code, set }) => {
      if (code === "VALIDATION") {
        set.status = 400;
        return { error: "Invalid request body" };
      }
    })
    .use(authGuard(database))
    // --- Checkout: create a 'paid' order from the cart --------------------
    .post(
      "/",
      async ({ userId, user, body, set }) => {
        // Resolve the user's cart.
        const [cart] = (await database`
          SELECT id FROM carts WHERE user_id = ${userId}
        `) as [{ id: number }?];
        if (!cart) {
          set.status = 400;
          return { error: "Cart is empty" };
        }

        // Verify the chosen address belongs to the user.
        const [address] = (await database`
          SELECT * FROM addresses WHERE id = ${body.address_id} AND user_id = ${userId}
        `) as [AddressRow?];
        if (!address) {
          set.status = 404;
          return { error: "Address not found" };
        }

        const redeemRequested = body.redeem_points ?? 0;

        try {
          // begin() rolls back on throw and rethrows, so a CheckoutError
          // thrown inside aborts the whole order; we map it below.
          const result = await database.begin(async (tx) => {
            // Re-read lines + CURRENT book prices/stock from the DB; never
            // trust any client-supplied amount.
            const lines = (await tx`
              SELECT ci.book_id    AS book_id,
                     ci.quantity   AS quantity,
                     b.title       AS title,
                     b.author      AS author,
                     b.price_cents AS price_cents,
                     b.stock       AS stock
                FROM cart_items ci
                JOIN books b ON b.id = ci.book_id
               WHERE ci.cart_id = ${cart.id}
               ORDER BY ci.id ASC
            `) as {
              book_id: number;
              quantity: number;
              title: string;
              author: string;
              price_cents: number;
              stock: number;
            }[];

            if (lines.length === 0) {
              throw new CheckoutError(400, "Cart is empty");
            }

            // Validate stock for every line before mutating anything.
            for (const line of lines) {
              if (line.quantity > line.stock) {
                throw new CheckoutError(
                  409,
                  `Insufficient stock for "${line.title}"`,
                );
              }
            }

            const subtotal_cents = lines.reduce(
              (sum, l) => sum + l.price_cents * l.quantity,
              0,
            );

            // Clamp redemption to the user's balance AND the subtotal.
            const maxRedeemByBalance = user.gift_points;
            const maxRedeemBySubtotal = Math.floor(
              subtotal_cents / PAISE_PER_POINT,
            );
            const points_redeemed = Math.max(
              0,
              Math.min(redeemRequested, maxRedeemByBalance, maxRedeemBySubtotal),
            );
            const redemption_cents = points_redeemed * PAISE_PER_POINT;
            const total_cents = subtotal_cents - redemption_cents;

            const points_earned = Math.floor(
              total_cents / PAISE_PER_EARNED_POINT,
            );

            // Decrement stock for every line.
            for (const line of lines) {
              await tx`
                UPDATE books SET stock = stock - ${line.quantity} WHERE id = ${line.book_id}
              `;
            }

            // Adjust the user's gift_points: subtract redeemed, add earned.
            await tx`
              UPDATE users
                 SET gift_points = gift_points - ${points_redeemed} + ${points_earned}
               WHERE id = ${userId}
            `;

            const now = new Date();
            const placed_at = now.toISOString();
            const cancellable_until = new Date(
              now.getTime() + 48 * 60 * 60 * 1000,
            ).toISOString();

            const [order] = (await tx`
              INSERT INTO orders
                (user_id, address_snapshot, status, payment_method,
                 subtotal_cents, points_redeemed, points_earned, total_cents,
                 placed_at, cancellable_until)
              VALUES (${userId}, ${JSON.stringify(address)}, 'paid',
                      ${body.payment_method ?? "MOCK"}, ${subtotal_cents},
                      ${points_redeemed}, ${points_earned}, ${total_cents},
                      ${placed_at}, ${cancellable_until})
              RETURNING *
            `) as [OrderRow?];

            if (!order) throw new CheckoutError(500, "Failed to create order");

            for (const line of lines) {
              await tx`
                INSERT INTO order_items
                  (order_id, book_id, title, author, unit_price_cents, quantity)
                VALUES (${order.id}, ${line.book_id}, ${line.title},
                        ${line.author}, ${line.price_cents}, ${line.quantity})
              `;
            }

            // Clear the cart.
            await tx`DELETE FROM cart_items WHERE cart_id = ${cart.id}`;

            return order;
          });

          set.status = 201;
          return { order: await toOrderView(database, result as OrderRow) };
        } catch (err) {
          if (err instanceof CheckoutError) {
            set.status = err.status;
            return { error: err.message };
          }
          throw err;
        }
      },
      {
        body: t.Object({
          address_id: t.Integer({ minimum: 1 }),
          redeem_points: t.Optional(t.Integer({ minimum: 0 })),
          payment_method: t.Optional(t.String()),
        }),
      },
    )
    // --- List the user's orders (newest first) ----------------------------
    .get("/", async ({ userId }) => {
      const orders = (await database`
        SELECT * FROM orders WHERE user_id = ${userId}
         ORDER BY placed_at DESC, id DESC
      `) as OrderRow[];
      return {
        orders: await Promise.all(orders.map((o) => toOrderView(database, o))),
      };
    })
    // --- Single owned order -----------------------------------------------
    .get(
      "/:id",
      async ({ userId, params, set }) => {
        const [order] = (await database`
          SELECT * FROM orders WHERE id = ${params.id} AND user_id = ${userId}
        `) as [OrderRow?];
        if (!order) {
          set.status = 404;
          return { error: "Order not found" };
        }
        return { order: await toOrderView(database, order) };
      },
      { params: t.Object({ id: t.Numeric() }) },
    )
    // --- Cancel within the 48h window (server-enforced) -------------------
    .post(
      "/:id/cancel",
      async ({ userId, params, set }) => {
        const [order] = (await database`
          SELECT * FROM orders WHERE id = ${params.id} AND user_id = ${userId}
        `) as [OrderRow?];
        if (!order) {
          set.status = 404;
          return { error: "Order not found" };
        }

        if (order.status !== "paid") {
          set.status = 409;
          return { error: "Order cannot be cancelled" };
        }

        // Compare against the STORED cancellable_until, never a client value.
        if (Date.now() > parseSqlTime(order.cancellable_until)) {
          set.status = 403;
          return { error: "Cancellation window expired" };
        }

        const updated = await database.begin(async (tx) => {
          // Restore stock for each line.
          const items = (await tx`
            SELECT * FROM order_items WHERE order_id = ${order.id}
          `) as OrderItemRow[];
          for (const item of items) {
            await tx`
              UPDATE books SET stock = stock + ${item.quantity} WHERE id = ${item.book_id}
            `;
          }

          // Refund redeemed points and reverse earned points.
          await tx`
            UPDATE users
               SET gift_points = gift_points + ${order.points_redeemed} - ${order.points_earned}
             WHERE id = ${userId}
          `;

          const [row] = (await tx`
            UPDATE orders SET status = 'cancelled' WHERE id = ${order.id} RETURNING *
          `) as [OrderRow?];
          return row!;
        });

        return { order: await toOrderView(database, updated as OrderRow) };
      },
      { params: t.Object({ id: t.Numeric() }) },
    )
    // --- Buy again: re-add the order's books to the current cart ----------
    .post(
      "/:id/buy-again",
      async ({ userId, params, set }) => {
        const [order] = (await database`
          SELECT id FROM orders WHERE id = ${params.id} AND user_id = ${userId}
        `) as [{ id: number }?];
        if (!order) {
          set.status = 404;
          return { error: "Order not found" };
        }

        const [cart] = (await database`
          SELECT id FROM carts WHERE user_id = ${userId}
        `) as [{ id: number }?];
        let cartId = cart?.id;
        if (cartId === undefined) {
          const [created] = (await database`
            INSERT INTO carts (user_id) VALUES (${userId}) RETURNING id
          `) as [{ id: number }?];
          cartId = created!.id;
        }

        await database.begin(async (tx) => {
          const items = (await tx`
            SELECT book_id, quantity FROM order_items WHERE order_id = ${order.id}
          `) as { book_id: number; quantity: number }[];

          for (const item of items) {
            // Only re-add books that still exist and have stock.
            const [book] = (await tx`
              SELECT stock FROM books WHERE id = ${item.book_id}
            `) as [{ stock: number }?];
            if (!book || book.stock <= 0) continue;

            const [existing] = (await tx`
              SELECT id, quantity FROM cart_items
               WHERE cart_id = ${cartId} AND book_id = ${item.book_id}
            `) as [{ id: number; quantity: number }?];

            const desired = (existing?.quantity ?? 0) + item.quantity;
            const clamped = Math.min(desired, book.stock);

            if (existing) {
              await tx`
                UPDATE cart_items SET quantity = ${clamped} WHERE id = ${existing.id}
              `;
            } else {
              await tx`
                INSERT INTO cart_items (cart_id, book_id, quantity)
                VALUES (${cartId}, ${item.book_id}, ${Math.min(item.quantity, book.stock)})
              `;
            }
          }
        });

        return buildCartView(database, cartId);
      },
      { params: t.Object({ id: t.Numeric() }) },
    );

/** Internal error used to roll back the checkout transaction with a status. */
class CheckoutError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}
