import { Elysia } from "elysia";
import { authRoutes } from "./auth";
import { bookRoutes } from "./books";
import { recommendationRoutes } from "./recommendations";

/**
 * Root API app mounted at the `/api` prefix. Domain route modules (auth,
 * books, recommendations, and later cart, addresses, orders) attach here via
 * `.use(...)`. Auth routes resolve under /api/auth/*; the catalogue and
 * recommendations routes resolve directly under /api/* (they carry their own
 * paths, e.g. /api/books, /api/categories, /api/recommendations).
 */
export const api = new Elysia({ prefix: "/api" })
  .get("/health", () => ({ status: "ok" }))
  .use(authRoutes())
  .use(bookRoutes())
  .use(recommendationRoutes());

export type Api = typeof api;
