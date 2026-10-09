import { Elysia, t } from "elysia";
import type { Database } from "bun:sqlite";
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
 * SQLite stores placed_at / cancellable_until as UTC "YYYY-MM-DD HH:MM:SS"
 * (CURRENT_TIMESTAMP) or ISO strings we insert. Parse to epoch ms, treating a
 * bare timestamp as UTC. Returns NaN for unparseable input (treated as
 * expired by callers).
 */
function parseSqlTime(value: string): number {
  // Already ISO with timezone?
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(value)) return Date.parse(value);
  // Bare "YYYY-MM-DD HH:MM:SS" -> treat as UTC.
  return Date.parse(value.replace(" ", "T") + "Z");
}

/** Assemble an OrderView from a stored order row. */
function toOrderView(database: Database, order: OrderRow): OrderView {
  const items = database
    .query<OrderItemRow, [number]>(
      "SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC",
    )
    .all(order.id);

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

export const orderRoutes = (database: Database = sharedDb) =>
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
      ({ userId, user, body, set }) => {
        // Resolve the user's cart.
        const cart = database
          .query<{ id: number }, [number]>(
            "SELECT id FROM carts WHERE user_id = ?",
          )
          .get(userId);
        if (!cart) {
          set.status = 400;
          return { error: "Cart is empty" };
        }

        // Verify the chosen address belongs to the user.
        const address = database
          .query<AddressRow, [number, number]>(
            "SELECT * FROM addresses WHERE id = ? AND user_id = ?",
          )
          .get(body.address_id, userId);
        if (!address) {
          set.status = 404;
          return { error: "Address not found" };
        }

        const redeemRequested = body.redeem_points ?? 0;

        try {
          const result = database.transaction(() => {
            // Re-read lines + CURRENT book prices/stock from the DB; never
            // trust any client-supplied amount.
            const lines = database
              .query<
                {
                  book_id: number;
                  quantity: number;
                  title: string;
                  author: string;
                  price_cents: number;
                  stock: number;
                },
                [number]
              >(
                `SELECT ci.book_id    AS book_id,
                        ci.quantity   AS quantity,
                        b.title       AS title,
                        b.author      AS author,
                        b.price_cents AS price_cents,
                        b.stock       AS stock
                   FROM cart_items ci
                   JOIN books b ON b.id = ci.book_id
                  WHERE ci.cart_id = ?
                  ORDER BY ci.id ASC`,
              )
              .all(cart.id);

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
              database.run(
                "UPDATE books SET stock = stock - ? WHERE id = ?",
                [line.quantity, line.book_id],
              );
            }

            // Adjust the user's gift_points: subtract redeemed, add earned.
            database.run(
              "UPDATE users SET gift_points = gift_points - ? + ? WHERE id = ?",
              [points_redeemed, points_earned, userId],
            );

            const now = new Date();
            const placed_at = now.toISOString();
            const cancellable_until = new Date(
              now.getTime() + 48 * 60 * 60 * 1000,
            ).toISOString();

            const order = database
              .query<
                OrderRow,
                [
                  number,
                  string,
                  string,
                  number,
                  number,
                  number,
                  number,
                  string,
                  string,
                ]
              >(
                `INSERT INTO orders
                   (user_id, address_snapshot, status, payment_method,
                    subtotal_cents, points_redeemed, points_earned, total_cents,
                    placed_at, cancellable_until)
                 VALUES (?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?)
                 RETURNING *`,
              )
              .get(
                userId,
                JSON.stringify(address),
                body.payment_method ?? "MOCK",
                subtotal_cents,
                points_redeemed,
                points_earned,
                total_cents,
                placed_at,
                cancellable_until,
              );

            if (!order) throw new CheckoutError(500, "Failed to create order");

            for (const line of lines) {
              database.run(
                `INSERT INTO order_items
                   (order_id, book_id, title, author, unit_price_cents, quantity)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                  order.id,
                  line.book_id,
                  line.title,
                  line.author,
                  line.price_cents,
                  line.quantity,
                ],
              );
            }

            // Clear the cart.
            database.run("DELETE FROM cart_items WHERE cart_id = ?", [cart.id]);

            return order;
          })();

          set.status = 201;
          return { order: toOrderView(database, result) };
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
    .get("/", ({ userId }) => {
      const orders = database
        .query<OrderRow, [number]>(
          "SELECT * FROM orders WHERE user_id = ? ORDER BY datetime(placed_at) DESC, id DESC",
        )
        .all(userId);
      return { orders: orders.map((o) => toOrderView(database, o)) };
    })
    // --- Single owned order -----------------------------------------------
    .get(
      "/:id",
      ({ userId, params, set }) => {
        const order = database
          .query<OrderRow, [number, number]>(
            "SELECT * FROM orders WHERE id = ? AND user_id = ?",
          )
          .get(params.id, userId);
        if (!order) {
          set.status = 404;
          return { error: "Order not found" };
        }
        return { order: toOrderView(database, order) };
      },
      { params: t.Object({ id: t.Numeric() }) },
    )
    // --- Cancel within the 48h window (server-enforced) -------------------
    .post(
      "/:id/cancel",
      ({ userId, params, set }) => {
        const order = database
          .query<OrderRow, [number, number]>(
            "SELECT * FROM orders WHERE id = ? AND user_id = ?",
          )
          .get(params.id, userId);
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

        const updated = database.transaction(() => {
          // Restore stock for each line.
          const items = database
            .query<OrderItemRow, [number]>(
              "SELECT * FROM order_items WHERE order_id = ?",
            )
            .all(order.id);
          for (const item of items) {
            database.run("UPDATE books SET stock = stock + ? WHERE id = ?", [
              item.quantity,
              item.book_id,
            ]);
          }

          // Refund redeemed points and reverse earned points.
          database.run(
            "UPDATE users SET gift_points = gift_points + ? - ? WHERE id = ?",
            [order.points_redeemed, order.points_earned, userId],
          );

          return database
            .query<OrderRow, [number]>(
              "UPDATE orders SET status = 'cancelled' WHERE id = ? RETURNING *",
            )
            .get(order.id)!;
        })();

        return { order: toOrderView(database, updated) };
      },
      { params: t.Object({ id: t.Numeric() }) },
    )
    // --- Buy again: re-add the order's books to the current cart ----------
    .post(
      "/:id/buy-again",
      ({ userId, params, set }) => {
        const order = database
          .query<{ id: number }, [number, number]>(
            "SELECT id FROM orders WHERE id = ? AND user_id = ?",
          )
          .get(params.id, userId);
        if (!order) {
          set.status = 404;
          return { error: "Order not found" };
        }

        const cart = database
          .query<{ id: number }, [number]>(
            "SELECT id FROM carts WHERE user_id = ?",
          )
          .get(userId);
        const cartId =
          cart?.id ??
          database
            .query<{ id: number }, [number]>(
              "INSERT INTO carts (user_id) VALUES (?) RETURNING id",
            )
            .get(userId)!.id;

        database.transaction(() => {
          const items = database
            .query<{ book_id: number; quantity: number }, [number]>(
              "SELECT book_id, quantity FROM order_items WHERE order_id = ?",
            )
            .all(order.id);

          for (const item of items) {
            // Only re-add books that still exist and have stock.
            const book = database
              .query<{ stock: number }, [number]>(
                "SELECT stock FROM books WHERE id = ?",
              )
              .get(item.book_id);
            if (!book || book.stock <= 0) continue;

            const existing = database
              .query<{ id: number; quantity: number }, [number, number]>(
                "SELECT id, quantity FROM cart_items WHERE cart_id = ? AND book_id = ?",
              )
              .get(cartId, item.book_id);

            const desired = (existing?.quantity ?? 0) + item.quantity;
            const clamped = Math.min(desired, book.stock);

            if (existing) {
              database.run("UPDATE cart_items SET quantity = ? WHERE id = ?", [
                clamped,
                existing.id,
              ]);
            } else {
              database.run(
                "INSERT INTO cart_items (cart_id, book_id, quantity) VALUES (?, ?, ?)",
                [cartId, item.book_id, Math.min(item.quantity, book.stock)],
              );
            }
          }
        })();

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
