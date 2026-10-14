import index from "./frontend/index.html";
import { api } from "./api";
import { initDb } from "./db";
import { DEV_JWT_SECRET } from "./lib/auth";

// Warn loudly when the insecure dev JWT secret is used outside development.
// This fires before the server starts so the misconfiguration is impossible
// to miss in staging / production logs.
const jwtSecret = process.env.JWT_SECRET ?? "";
if (
  (jwtSecret.length === 0 || jwtSecret === DEV_JWT_SECRET) &&
  process.env.NODE_ENV !== "development"
) {
  console.warn(
    "[security] WARNING: JWT_SECRET is unset or using the insecure dev fallback. " +
      "Set a strong random secret via the JWT_SECRET environment variable before deploying.",
  );
}

// Create the schema and seed the catalogue (idempotent) before serving so the
// first boot provisions the PostgreSQL tables + catalogue and later boots are
// no-ops. Bun.sql is async, so initialisation is awaited (top-level await).
await initDb();

const port = Number(process.env.PORT) || 3000;
const isDevelopment = process.env.NODE_ENV !== "production";

const server = Bun.serve({
  port,
  development: isDevelopment,
  routes: {
    // Elysia owns the REST API. This specific route is matched before the
    // SPA catch-all below, so /api/* never falls through to the HTML shell.
    "/api/*": (req) => api.fetch(req),
    // HTML catch-all: Bun's Fullstack Dev Server bundles and serves the SPA
    // shell so client-side deep links fall back to index.html.
    "/*": index,
  },
});

console.log(`BooksOnline listening on http://localhost:${server.port}`);
