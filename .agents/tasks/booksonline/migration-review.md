# bun:sqlite → PostgreSQL (Bun.sql) migration

Swaps the data layer from `bun:sqlite` to Bun's built-in SQL client (`import { SQL } from "bun"`) talking to PostgreSQL, while holding the HTTP contract, response shapes, status codes, and the entire frontend fixed. Credentials are centralized in `src/db/index.ts`, which reads `DATABASE_URL` and falls back to the documented default `postgres://postgres:password@localhost:5432/booksonline`. Every query became an async, parameterized Bun.sql tagged template; schema DDL moved to Postgres idioms (IDENTITY PKs, BOOLEAN, `now()::text`, `IF NOT EXISTS`); the 23-book / 7-category / 21-publisher INR-paise catalogue and its Open Library cover URLs are unchanged. Boot is now `await initDb()` (async schema + idempotent seed) before `Bun.serve()`, still single-port.

Watch for: nothing blocking. Two cosmetic items — a doc comment in `schema.ts` says the DDL runs via `.simple()` when it actually runs `.unsafe(...).simple()` (confirmed, harmless), and `database.unsafe(...)` is used in `schema.ts`/`addresses.ts` but only ever on hardcoded static strings, never user input (confirmed injection-safe).

**Verdict**: APPROVED

## High-level view

The connection is a single Bun.sql singleton built in `src/db/index.ts`; `DATABASE_URL` is the only input and the exact default string is preserved, with the test suite honoring `TEST_DATABASE_URL`. No PostgreSQL driver, ORM, or Node tooling entered `package.json` — Bun.sql is built in — so the stack stays 100% Bun-native on one port.

The schema translated to Postgres idioms without changing semantics: `INTEGER GENERATED ALWAYS AS IDENTITY` primary keys, real `REFERENCES` foreign keys, the same five indexes, a `BOOLEAN` `is_default`, and `now()::text` defaults. `placed_at`/`cancellable_until` stay TEXT ISO strings — the exact representation the checkout writes and `parseSqlTime` reads — so the 48h cancel math is byte-for-byte the same computation as before.

Every query is a parameterized Bun.sql tagged template. User input is only ever bound with `${...}` or array-bound via `database(array)`; the only `database.unsafe(...)` calls operate on hardcoded column/DDL strings. COUNT/aggregate results are explicitly cast `::int` and wrapped in `Number(...)`, and the Postgres `BOOLEAN` `is_default` is coerced back to numeric `0|1` with `(is_default)::int`, so response shapes stay numerically identical to the SQLite version.

The commerce behavior is preserved exactly: redemption clamps to both the user's balance and the subtotal so `total_cents` can't go negative, earning is `floor(total_cents / 10000)`, welcome balance is 0, checkout decrements stock and writes `status='paid'` / `payment_method='MOCK'` inside one transaction, cancel enforces the stored window (409 wrong status, 403 expired), and buy-again/recommendations keep the history-then-popular strategy. Protected routes still 401 unauthenticated and scope every query to the JWT user id.

Verification evidence is present and consistent with the code: `bun install` (nothing Node-based added), `bunx tsc --noEmit` (0 errors), `bun test` (54 pass / 0 fail against real Postgres), and a documented live e2e covering numeric totals, points math (`points_earned=13`), stock decrement, 403 outside the cancel window, and cross-user isolation. No frontend file changed.

<details>
<summary>Issues (2)</summary>

1. **schema.ts doc/impl wording** — comment says DDL runs via `.simple()` but the code is `.unsafe(...).simple()`; non-blocking, update the comment for accuracy.
2. **`database.unsafe()` usage** — present in `schema.ts` (static DDL) and `addresses.ts` (static `ADDRESS_COLUMNS`); confirmed to never touch user input, so injection-safe. Keep an eye on it if that constant ever becomes dynamic.

</details>

<details>
<summary>Details</summary>

### Connection module and credential centralization

`src/db/index.ts` is the single owner of the connection string. `connectionString()` reads `process.env.DATABASE_URL` and falls back to `DEFAULT_DATABASE_URL = "postgres://postgres:password@localhost:5432/booksonline"` — the exact value required. The comment notes the string is built explicitly rather than relying on Bun's implicit env detection, specifically so the default is honored and credentials aren't scattered; grep confirms no other module hardcodes a connection string. `openDb(url)` wraps `new SQL(url)` and tests pass `process.env.TEST_DATABASE_URL ?? undefined` so an unset override transparently falls back. The shared `db` singleton is constructed at import time and `initDb()` awaits `initSchema()` then `seedIfEmpty()` — both idempotent, safe on every boot.

No SQLite residue remains: a search for `bun:sqlite`, `new Database(`, `PRAGMA`, `store.sqlite`, `DB_PATH`, `.sqlite` across `src/**/*.ts` returns nothing. `package.json` carries no `pg`, no ORM, no SQLite driver; the data layer rides entirely on Bun's built-in client. `server.ts` still serves on one port with the `/api/*` Elysia route ahead of the `/*` HTML catch-all.

### Schema translation and the 48h cancel representation

The DDL moved to Postgres idioms while keeping column semantics: `INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY` replaces SQLite autoincrement, foreign keys use real `REFERENCES`, the five indexes are recreated with `IF NOT EXISTS`, the orders `status` CHECK constraint is intact, and `*_cents` stays `INTEGER` paise. `is_default` is a real `BOOLEAN` (coerced back to `0|1` at the API boundary — see below). All DDL is wrapped in `IF NOT EXISTS` and issued as one script, so re-running on boot is a no-op.

`placed_at` and `cancellable_until` are deliberately kept as TEXT ISO-8601 strings — the same `new Date(...).toISOString()` the checkout writes and the same `parseSqlTime` reads back. `cancellable_until` is still computed at insert as `placed_at + 48h`. Because the stored representation and the parsing are unchanged, the cancel-window comparison (`Date.now() > parseSqlTime(order.cancellable_until)`) yields identical results to the SQLite version. `parseSqlTime` additionally handles a bare `now()::text` default as UTC, which matters only for rows not written by checkout.

### Parameterization and SQL-injection safety

Every query is a Bun.sql tagged template with `${...}` binding. The catalogue listing in `books.ts` builds its WHERE clause from parameterized fragments reduced together (`database\`WHERE ${c}\`` / `database\`${acc} AND ${c}\``), search uses `ILIKE ${like}` with the wildcard wrapper bound as a value, and the sort fragment is chosen from a fixed `SORT_KEYS` allowlist (never user input) before being spliced as a Bun.sql fragment. `LIMIT ${pageSize} OFFSET ${offset}` are bound after server-side clamping to `MAX_PAGE_SIZE`.

`recommendations.ts` composes facet `IN` clauses via array binding — `database(category IN ${database([...categories])})` and `id NOT IN ${database(purchasedIds)}` — so even the set membership is parameterized, not interpolated. The only `database.unsafe(...)` calls are `schema.ts` (the static DDL script) and `addresses.ts` (the hardcoded `ADDRESS_COLUMNS` constant); neither incorporates request data. There is no user-input string concatenation anywhere in the converted queries.

### Response-shape fidelity: numeric coercion and boolean handling

Postgres returns `COUNT(*)` as a bigint and `BOOLEAN` as a JS boolean, either of which would change response shapes if passed through raw. The migration guards both. Counts are cast `COUNT(*)::int` and wrapped in `Number(...)` in the books listing total, the categories/publishers aggregates, and the db tests — the live e2e confirmed `total=23` serialized as a JSON number. The `is_default` boolean is selected back as `(is_default)::int AS is_default` through the shared `ADDRESS_COLUMNS` list and typed as `number` on `AddressRow`, so the frontend keeps receiving numeric `0|1`; the e2e confirmed `is_default` returned as numeric `1`. The PATCH path correctly converts the stored `existing.is_default === 1` back to a JS boolean when binding to the BOOLEAN column.

### Commerce behavior preservation

Checkout (`POST /orders`) runs inside `database.begin`, re-reads current prices and stock from the DB (never trusting client amounts), validates stock per line (409 on shortfall), computes `subtotal_cents`, then clamps redemption to `max(0, min(requested, balance, floor(subtotal/100)))` so `total_cents` is never negative. Earning is `floor(total_cents / 10000)` (1 point per ₹100). Stock is decremented per line, `gift_points` adjusted by `- redeemed + earned`, and the order is written with `status='paid'`, `payment_method` defaulting to `'MOCK'`, via `INSERT ... RETURNING *`. The e2e recorded `points_earned=13` from `floor(136000/10000)` and a 5→3 stock decrement — the math is intact.

Cancel re-checks ownership (404), rejects non-`paid` orders with 409, enforces the stored window with 403, and on success restores stock and reverses points inside a transaction. The e2e exercised both a successful in-window cancel (200, `status=cancelled`) and a backdated order rejected with 403 while remaining `paid`. Buy-again re-adds owned-order books to the cart, skipping out-of-stock titles and clamping quantities to available stock. Recommendations keep the history-driven facet match (category/author/publisher of non-cancelled purchases, excluding already-owned) with a top-rated in-stock popular fallback that always returns a non-empty list when the catalogue has books.

### Auth and per-user isolation

`lib/auth.ts` and `auth.ts` changed only to become async against Bun.sql; the JWT sign/verify, `Bun.password` (argon2id) hashing, constant-time signature comparison, and the `authGuard` that reloads the user from the DB on every request are behaviorally unchanged. Register still sets the welcome `gift_points` to 0 and provisions the user's cart row. The guard throws `UnauthorizedError` → 401 on missing/invalid/expired tokens or unknown users, and every protected query is scoped by the resolved `userId` — another user's order/address/cart resolves to 404. The e2e confirmed unauthenticated `GET /api/cart` → 401 and full cross-user isolation (user B sees empty collections, cannot read or mutate A's rows).

### Seed fidelity

`seed.ts` keeps all 23 books across 7 categories (Fiction, Fantasy, Science Fiction, Mystery/Thriller, Self-Help, Business, History) and ~21 publishers, with INR paise `price_cents` and `https://covers.openlibrary.org/b/isbn/<isbn>-L.jpg` cover URLs unchanged. The seed guard is `SELECT COUNT(*)::int ... FROM books` short-circuiting when rows exist, and inserts run in one `database.begin` transaction; IDENTITY assigns ids so no sequence reset is needed. `db.test.ts` asserts idempotency explicitly (running `seedIfEmpty` twice doesn't change the count) and that every book has a non-empty cover and positive price.

### Verification evidence

`test-report.md` and `verification.md` record `bun install` (112 installs, no changes, nothing Node-based), `bunx tsc --noEmit` (exit 0), and `bun test` (54 pass / 0 fail across 5 files) against the real local Postgres with `DATABASE_URL` unset (default used). The live e2e covered health, numeric `total`, 7 categories / 21 publishers, 401 on unauthenticated cart, register→login→me→points, numeric `subtotal_cents` and `is_default`, checkout (`status=paid`, `payment_method=MOCK`, `points_earned=13`, non-negative total, `isCancellable=true`), stock decrement, order listing newest-first, buy-again, history recommendations, in-window cancel, 403 backdated cancel, cross-user isolation, and post-shutdown persistence in Postgres with FK enforcement. The evidence lines up with the code read here; per instructions the suite was not re-run.

<details>
<summary>File map</summary>

- `src/db/index.ts` — Bun.sql connection singleton, `DATABASE_URL` + default, async `initDb`
- `src/db/schema.ts` — Postgres DDL (IDENTITY, FKs, BOOLEAN, indexes, `IF NOT EXISTS`)
- `src/db/seed.ts` — async idempotent seed; same 23-book INR catalogue
- `src/db/db.test.ts` — schema/seed tests against Postgres, idempotency assertion
- `src/api/books.ts` — catalogue listing (ILIKE, COUNT::int+Number, bound LIMIT/OFFSET, allowlisted sort)
- `src/api/cart.ts` — per-user cart, parameterized, lazy cart via RETURNING
- `src/api/addresses.ts` — `(is_default)::int` numeric coercion, static-column `unsafe`
- `src/api/orders.ts` — checkout/cancel/buy-again, points/stock/window logic, RETURNING, transactions
- `src/api/recommendations.ts` — array-bound IN facet match + popular fallback
- `src/api/auth.ts`, `src/lib/auth.ts` — async against Bun.sql; auth behavior unchanged
- `src/api/*.test.ts` — suites updated for async Postgres
- `src/server.ts` — `await initDb()` before single-port `Bun.serve()`
- `README.md` — documents PostgreSQL, default URL, Bun built-in client, centralized config
- `.gitignore` — removed `*.sqlite*` patterns; ignores `.env`
- `package.json` — no driver/ORM/Node tooling added

Full diff: `git diff main` in the workspace root.

</details>

</details>
