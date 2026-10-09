import { Elysia } from "elysia";
import { authRoutes } from "./auth";
import { bookRoutes } from "./books";
import { recommendationRoutes } from "./recommendations";
import { cartRoutes } from "./cart";
import { addressRoutes } from "./addresses";
import { orderRoutes } from "./orders";

/**
 * Root API app mounted at the `/api` prefix. Domain route modules (auth,
 * books, recommendations, cart, addresses, orders) attach here via
 * `.use(...)`. Auth routes resolve under /api/auth/*; cart/addresses/orders
 * carry their own sub-prefixes (/api/cart, /api/addresses, /api/orders); the
 * catalogue and recommendations routes resolve directly under /api/* (they
 * carry their own paths, e.g. /api/books, /api/categories).
 */
export const api = new Elysia({ prefix: "/api" })
  .get("/health", () => ({ status: "ok" }))
  .use(authRoutes())
  .use(bookRoutes())
  .use(recommendationRoutes())
  .use(cartRoutes())
  .use(addressRoutes())
  .use(orderRoutes());

export type Api = typeof api;
