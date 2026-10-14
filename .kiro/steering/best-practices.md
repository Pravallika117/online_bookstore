---
Inclusion: always
---

# Best Practices

## Bun-Native Stack
- Use Bun-native APIs exclusively: `Bun.serve`, `Bun.sql`, `Bun.password`, `bun:test`.
- Do not introduce Node.js-only packages (e.g. `pg`, `bcrypt`, `jest`), Vite, Webpack, or ORMs with Node bindings (e.g. Prisma, TypeORM).
- Bundling and dev server: `bun dev` (single command, no separate front-end dev server).

## Single-Port Architecture
- One `Bun.serve()` process serves both `/api/*` (ElysiaJS) and `/*` (React SPA).
- The HTML entry point is `src/frontend/index.html` (Bun HTML import).
- Never split API and frontend into two processes or ports.

## API Design
- RESTful resource naming: plural nouns, nested by ownership (e.g. `/api/orders/:id/cancel`).
- Consistent JSON response envelope: success returns the resource or `{ message: string }`; failure returns `{ error: string }` with an appropriate HTTP status code.
- Validate every request body and query param with `Elysia t.Object()` (or `t.Optional`, `t.String`, etc.).
- HTTP status codes:
  - 200 for successful GET/PUT/PATCH
  - 201 for successful POST that creates a resource
  - 400 for validation errors
  - 401 for unauthenticated requests
  - 403 for forbidden (authenticated but not authorised)
  - 404 for not found
  - 409 for conflicts (duplicate resource)
  - 500 for unexpected server errors

## Database
- All SQL queries use Bun.sql tagged templates: `` database`SELECT ...` `` or `database(array)` for `IN` clauses. **Never string-interpolate user input into SQL.**
- Schema definitions are idempotent: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.
- Money is stored as `INTEGER` paise (1 INR = 100 paise). Never store money as float.
- Indexes are required on all foreign-key columns and high-cardinality filter columns (e.g. `books.category`, `books.publisher`).
- Wrap multi-step mutations (checkout, cancel, buy-again) in `database.begin()` transactions.

## Frontend Architecture
- All API calls go through the centralised client at `src/frontend/lib/api.ts`. **No raw `fetch()` calls inside pages or components.**
- Cross-cutting state (auth session, shopping cart) lives in React Context (`src/frontend/context/`).
- Page-level state (form values, loading flags) is local `useState`/`useReducer`.
- Money formatting: use a single `formatINR(paise: number): string` helper — never divide inline.

## Performance
- All list endpoints must be paginated: default page size 12, maximum 100.
- Use `LIMIT` / `OFFSET` (or cursor-based) pagination.
- Dynamic `WHERE` clauses are built with Bun.sql fragments — never by concatenating strings.

## Git Hygiene
- Commit messages follow Conventional Commits: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`.
- Never commit `.sqlite` files, `.env` files, or secrets.
- Stage only intended files — avoid `git add -A` or `git add .` without reviewing the diff first.
- Active development branch: `pg-db`. The `main` branch is the legacy SQLite version.
