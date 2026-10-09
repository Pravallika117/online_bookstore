# BooksOnline

An e-commerce platform to view, browse, and purchase books. Built 100% on the
Bun ecosystem — no Node.js, Vite, or Webpack.

## Stack

- **Runtime & bundler:** Bun (built-in Fullstack Dev Server via HTML imports + `Bun.serve()`)
- **Frontend:** React 19 + Tailwind CSS v4 + shadcn/ui (new-york)
- **Backend:** ElysiaJS REST API mounted under `/api`
- **Database:** Bun's native SQLite (`bun:sqlite`), no external database

One `Bun.serve()` process serves the bundled SPA and the Elysia API on a single
port.

## Getting started

```sh
bun install
bun dev
```

The app runs on http://localhost:3000 (override with the `PORT` env var).

- `bun dev` — start the dev server with hot reload
- `bun start` — start the server
- `bun test` — run the test suite
- `bun run typecheck` — type-check with `tsc --noEmit`

## API

- `GET /api/health` — health check, returns `{ "status": "ok" }`

More endpoints and the full feature list arrive with later features.
