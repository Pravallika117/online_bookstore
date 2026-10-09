import index from "./frontend/index.html";
import { api } from "./api";
import { initDb } from "./db";

// Create the schema and seed the catalogue (idempotent) before serving so the
// first boot provisions store.sqlite and later boots are no-ops.
initDb();

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
