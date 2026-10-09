import { Elysia } from "elysia";
import { authRoutes } from "./auth";

/**
 * Root API app mounted at the `/api` prefix. Domain route modules (auth, and
 * later books, cart, addresses, orders, recommendations) attach here via
 * `.use(...)`. Auth routes resolve under /api/auth/*.
 */
export const api = new Elysia({ prefix: "/api" })
  .get("/health", () => ({ status: "ok" }))
  .use(authRoutes());

export type Api = typeof api;
