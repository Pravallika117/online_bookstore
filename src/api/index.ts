import { Elysia } from "elysia";

/**
 * Root API app mounted at the `/api` prefix. Later FEATs attach the domain
 * route modules (auth, books, cart, addresses, orders, recommendations) here
 * via `.use(...)`. For the scaffold it exposes only a health check.
 */
export const api = new Elysia({ prefix: "/api" }).get("/health", () => ({
  status: "ok",
}));

export type Api = typeof api;
