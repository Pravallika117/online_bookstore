# Implementation Plan — Migrate BooksOnline from bun:sqlite to PostgreSQL (Bun.sql)

This is a database-layer migration, not a rewrite. Every response shape, field name, status code, API contract, and the entire frontend must stay byte-for-byte identical. The only thing that changes is where/how data is stored and the fact that DB access becomes async.

## Design decisions (made here, grounded in the code I read)

- **Client:** Bun's built-in `Bun.sql` (`import { SQL } from "bun"`), no external driver. Rationale: the task mandates it and Bun 1.4.2 ships a complete Promise-based Postgres client (tagged templates, connection pool, transactions, `RETURNING`). No blocker found in the docs.
- **Connection:** Centralize in `src/db/index.ts`. Read `process.env.DATABASE_URL`, defaulting to exactly `postgres://postgres:password@localhost:5432/booksonline`. Construct one shared `SQL` instance (`new SQL(connectionString)`). Tests override via `TEST_DATABASE_URL` (mirrors the old `DB_PATH` role); if unset, fall back to `DATABASE_URL`/default. Do NOT rely on Bun's implicit env auto-detection — build the string explicitly so the documented default is honored and credentials are not scattered.
- **Async ripple:** `Bun.sql` is async. `db` becomes a `SQL` instance; `.query(...).all()/.get()/.run()` disappears. Every route handler that touches the DB becomes `async` and `await`s each query. Elysia handlers may be async (auth.ts already uses async handlers), so this is mechanical but must be complete — a missed `await` returns a Promise into the JSON body and breaks the contract.
- **Timestamps:** Keep `placed_at`/`cancellable_until` as **TEXT storing ISO-8601 strings** (what `orders.ts` already inserts via `new Date().toISOString()` and what `parseSqlTime` parses). This keeps the 48h cancel math untouched. Use `TEXT` columns (not `TIMESTAMPTZ`) so no representation changes and `parseSqlTime` keeps working verbatim. The seed/test helper `datetime('now','+48 hours')` (SQLite-only) must be replaced with a value computed in JS and bound as an ISO string.
- **Money:** Keep paise as `INTEGER`/`BIGINT`. `price_cents` etc. fit comfortably in `INTEGER`; keep `INTEGER`. `rating` is `REAL` → Postgres `REAL` (or `DOUBLE PRECISION`); use `REAL`.
- **Booleans:** `is_default` becomes `BOOLEAN` in Postgres. The API currently stores/returns `0|1` (`AddressRow.is_default: number`). To keep the response shape numeric and the frontend unchanged, SELECTs must return it as an integer. **Decision:** keep the column `BOOLEAN` and coerce on read with `(is_default)::int AS is_default`, and bind JS booleans on write. This preserves the `number` field in JSON. (Alternative — store as `INTEGER` 0/1 — also works but `BOOLEAN` is the idiomatic Postgres type the task asks for; the `::int` cast keeps the contract.)
- **Autoincrement:** `INTEGER PRIMARY KEY AUTOINCREMENT` → `GENERATED ALWAYS AS IDENTITY` (or `SERIAL`). Use `GENERATED ALWAYS AS IDENTITY` for `id` columns. Idempotent DDL via `CREATE TABLE IF NOT EXISTS`.
- **COUNT/aggregate typing:** Postgres returns `COUNT(*)` as a bigint → JS **string**. Every count (`total` in `/books`, category/publisher `count`, the test `count` assertions) must be coerced with `Number(...)` so response shapes stay numeric.
- **Case-insensitive sort/search:** SQLite `LIKE` is case-insensitive by default and `COLLATE NOCASE` is used for sort. Postgres `LIKE` is case-sensitive. Replace search `LIKE` with `ILIKE`; replace `ORDER BY ... COLLATE NOCASE ASC` with `ORDER BY LOWER(col) ASC`.
- **Dynamic SQL safety:** Replace the hand-built `?`/`$name` placeholder strings and `IN (?,?,...)` lists with `Bun.sql` tagged templates plus the `sql()` fragment helper and `sql([...])` for `WHERE IN`. Never string-concatenate user input. The `/books` listing and `/recommendations` dynamic filters are the two tricky spots — detailed below.
- **Transactions:** `db.transaction(fn)` (sync) → `await sql.begin(async (tx) => { ... })`. Checkout, cancel, buy-again, and seed use transactions.
- **PRAGMAs removed:** `foreign_keys=ON`, `journal_mode=WAL` are SQLite-only — delete. FKs are always enforced in Postgres.

## Files to change

- `src/db/index.ts` — connection + `initDb` (now async)
- `src/db/schema.ts` — Postgres DDL (now async)
- `src/db/seed.ts` — Postgres idempotent seed (now async)
- `src/api/auth.ts`, `src/api/books.ts`, `src/api/recommendations.ts`, `src/api/cart.ts`, `src/api/addresses.ts`, `src/api/orders.ts` — convert every query
- `src/lib/auth.ts` — `findUserById` + guard become async; type imports change
- `src/server.ts` — `await initDb()` before serve
- `src/db/db.test.ts`, `src/api/auth.test.ts`, `src/api/books.test.ts`, `src/api/commerce.test.ts`, `src/api/recommendations.test.ts` — async + Postgres test DB + cleanup
- `README.md`, `.gitignore`, `package.json` (only if needed)

Shared type note: everywhere currently importing `type { Database } from "bun:sqlite"`, change to `import type { SQL } from "bun"` and rename the injected param type from `Database` to `SQL`. Keep the parameter name (`database`) so call sites read the same.

---

- [ ] 1. Rewrite the connection module `src/db/index.ts` to use `Bun.sql`.
      Export: `connectionString()` (reads `DATABASE_URL`, default `postgres://postgres:password@localhost:5432/booksonline`), `openDb(url?)` returning `new SQL(url ?? connectionString())`, async `initDb(database = db)` that `await initSchema(database)` then `await seedIfEmpty(database)` and returns it, and the shared singleton `export const db: SQL = openDb()`. Remove `bun:sqlite`, `resolve`, `import.meta.dir`, PRAGMAs, and the `DB_PATH` logic. (Tests construct their own `SQL` via `TEST_DATABASE_URL`; see step 11.)
      Files: src/db/index.ts
      Verify: `bunx tsc --noEmit` has no new errors originating in this file (call-site errors in other modules are expected until their steps land); defer full green to step 13.

- [ ] 2. Rewrite `src/db/schema.ts` for PostgreSQL, idempotent.
      Make `initSchema(db: SQL)` async. Issue the DDL as one multi-statement script via `await db` + `.simple()` (no params needed). Translate: `INTEGER PRIMARY KEY AUTOINCREMENT` → `INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY`; `TEXT`/`REAL`/`INTEGER` kept; `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP` kept as `TEXT` default `CURRENT_TIMESTAMP` cast to text — use `TEXT NOT NULL DEFAULT (now()::text)` to keep a string (books/users only read `created_at` as an opaque string; `newest` sorts lexically on it which stays monotonic with `now()::text`); `is_default INTEGER NOT NULL DEFAULT 0` → `BOOLEAN NOT NULL DEFAULT false`; `placed_at`/`cancellable_until` stay `TEXT`; keep the `status` CHECK constraint; keep all 5 indexes with `IF NOT EXISTS`; keep `UNIQUE(cart_id, book_id)` and `user_id UNIQUE` on carts. Use `CREATE TABLE IF NOT EXISTS` throughout.
      Files: src/db/schema.ts
      Verify: covered by step 11's db.test.ts run (table existence + types) once that step lands; for now `bunx tsc --noEmit` shows no error in this file.

- [ ] 2a. Decide and document the `created_at`/`newest`-sort invariant in a one-line comment in schema.ts: `newest` sort orders by `created_at DESC, id DESC`; `now()::text` ISO strings sort lexically in chronological order, and `id` is the deterministic tiebreaker, so the existing pagination test (non-overlapping pages) stays valid.
      Files: src/db/schema.ts
      Verify: part of step 13's `bun test` (books pagination test passes).

- [ ] 3. Rewrite `src/db/seed.ts` for PostgreSQL, idempotent, SAME 23 books.
      Make `seedIfEmpty(db: SQL)` async. Keep the `SEED_BOOKS` array and `COVER()` verbatim. Guard: `const [{ count }] = await db\`SELECT COUNT(*)::int AS count FROM books\`; if (Number(count) > 0) return;` (note `::int` cast). Insert inside `await db.begin(async (tx) => { for (const b of SEED_BOOKS) { await tx\`INSERT INTO books (title, author, publisher, description, price_cents, category, cover_url, stock, rating, delivery_lead_days) VALUES (${b.title}, ${b.author}, ${b.publisher}, ${b.description}, ${b.price_cents}, ${b.category}, ${b.cover_url}, ${b.stock}, ${b.rating}, ${b.delivery_lead_days})\`; } })`. IDENTITY handles ids; no sequence reset needed because inserts never specify id. Remove `db.prepare`/`db.transaction`.
      Files: src/db/seed.ts
      Verify: covered by step 11 (db.test.ts: non-empty catalogue, ≥4 categories/≥3 publishers, every book has cover+positive price, idempotent).

- [ ] 4. Convert `src/lib/auth.ts` to async DB access.
      Change `import type { Database } from "bun:sqlite"` → `import type { SQL } from "bun"`; change `sharedDb` import type accordingly. Make `findUserById(id, database): Promise<UserRow | null>` using `const [row] = await database\`SELECT * FROM users WHERE id = ${id}\`; return row ?? null;`. In `authGuard`, change the Elysia `seed:` to a stable string (e.g. `"auth-guard"`) — the current `seed: database` passed a sqlite handle for plugin dedup; a `SQL` object there is fine but prefer a constant so plugin identity is stable across injected DBs. The `.resolve` callback becomes `async` and `await`s `findUserById`. Keep `UnauthorizedError`, JWT, hashing untouched.
      Files: src/lib/auth.ts
      Verify: `bunx tsc --noEmit` no error in this file; auth behavior covered by step 11's auth.test.ts.

- [ ] 5. Convert `src/api/auth.ts` queries to Bun.sql.
      Handlers are already `async`. Replace: existence check → `const [existing] = await database\`SELECT id FROM users WHERE email = ${email}\`;`. Insert+return → `const [inserted] = await database\`INSERT INTO users (email, password_hash, name, gift_points) VALUES (${email}, ${password_hash}, ${body.name.trim()}, 0) RETURNING *\`;`. Cart provision → `await database\`INSERT INTO carts (user_id) VALUES (${inserted.id})\`;`. Login SELECT → `const [row] = await database\`SELECT * FROM users WHERE email = ${email}\`;`. Change `Database` type → `SQL`. Keep status codes (201/409/401/400) and `{ token, user }` shape identical.
      Files: src/api/auth.ts
      Verify: covered by step 11 auth.test.ts (all 13 assertions).

- [ ] 6. Convert `src/api/books.ts` — the dynamic listing is the trickiest query.
      Replace the `where[]`/`params` string-building with Bun.sql fragments. Build an array of condition fragments and compose: e.g. `const conds = []; if (search) conds.push(database\`(title ILIKE ${like} OR author ILIKE ${like})\`); if (category) conds.push(database\`category = ${category}\`); ...` then `const whereSql = conds.length ? database\`WHERE ${conds.reduce((a,c)=>database\`${a} AND ${c}\`)}\` : database\`\`;`. Order: map `SORTS` to fragments and pick one (title sort → `LOWER(title) ASC, id ASC`). Count → `const [{ total }] = await database\`SELECT COUNT(*)::int AS total FROM books ${whereSql}\`;` then `Number(total)`. Page query → `await database\`SELECT * FROM books ${whereSql} ORDER BY ${orderFragment} LIMIT ${pageSize} OFFSET ${offset}\`;`. `/categories` and `/publishers`: `COUNT(*)::int AS count`, `ORDER BY LOWER(category) ASC` / `LOWER(publisher) ASC`, coerce each `count` to `Number`. `/books/:id`: `const [book] = await database\`SELECT * FROM books WHERE id = ${params.id}\`;` (404 unchanged); related → `await database\`SELECT * FROM books WHERE id <> ${book.id} AND (category = ${book.category} OR author = ${book.author} OR publisher = ${book.publisher}) ORDER BY rating DESC, id ASC LIMIT 6\`;`. Keep every response field (`items,total,page,pageSize`, `book,deliveryDate,deliveryDateDisplay,relatedProducts`) and `minPrice*100` paise conversion identical. If composing nested fragments proves awkward, the documented-and-acceptable fallback is `sql.unsafe(queryString, paramsArray)` with `$1,$2,...` positional params built in lockstep with a values array — still fully parameterized, no user input interpolated.
      Files: src/api/books.ts
      Verify: covered by step 11 books.test.ts (listing/search/category/publisher/price/sort×3/pagination, categories, publishers, book detail, 404).

- [ ] 7. Convert `src/api/recommendations.ts` — dynamic `IN` lists + exclude list.
      Replace manual `(?,?,...)` placeholder building with Bun.sql `WHERE IN` via array binding: `database\`category IN ${database(categoriesArray)}\``-style, or `sql.unsafe` with positional params if cleaner. Purchased ids: `await database\`SELECT DISTINCT oi.book_id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.user_id = ${userId} AND o.status <> 'cancelled'\`;`. Facet query likewise parameterized by `${userId}`. Build the history query by composing `category IN (...)`/`author IN (...)`/`publisher IN (...)` OR-clauses from the non-empty sets, plus optional `id NOT IN (purchasedIds)` exclusion, `ORDER BY rating DESC, id ASC LIMIT ${LIMIT}`. `popularFallback` becomes async and parameterizes its exclude list the same way. Keep `{ items, source }` and the `"history"|"popular"` logic identical.
      Files: src/api/recommendations.ts
      Verify: covered by step 11 recommendations.test.ts (401, popular fallback, history favors category + excludes purchased).

- [ ] 8. Convert `src/api/cart.ts` to async Bun.sql.
      `getOrCreateCartId` → async: `const [existing] = await database\`SELECT id FROM carts WHERE user_id = ${userId}\`;` else `const [created] = await database\`INSERT INTO carts (user_id) VALUES (${userId}) RETURNING id\`;`. `buildCartView` → async: the join SELECT with `b.price_cents * ci.quantity AS line_total_cents` is identical SQL, just `await database\`...WHERE ci.cart_id = ${cartId} ORDER BY ci.id ASC\``. Add/increment: SELECT book, SELECT existing line, then `await database\`UPDATE cart_items SET quantity = ${desiredQty} WHERE id = ${existing.id}\`` or `INSERT ... VALUES (${cartId}, ${body.bookId}, ${body.quantity})`. PATCH/DELETE: same translations, keep 404/409 and the 0-quantity-removes behavior. All four handlers become `async` and `await getOrCreateCartId`/`buildCartView`. Change `Database`→`SQL`.
      Files: src/api/cart.ts
      Verify: covered by step 11 commerce.test.ts (cart add/line totals, >stock 409, auth 401) and buy-again which reuses buildCartView.

- [ ] 9. Convert `src/api/addresses.ts` to async Bun.sql with BOOLEAN handling.
      `clearDefault` → async `await database\`UPDATE addresses SET is_default = false WHERE user_id = ${userId}\`;`. All SELECTs that return addresses must coerce the boolean back to the numeric contract: select `*, (is_default)::int AS is_default` — i.e. replace `SELECT *` with an explicit column list ending in `(is_default)::int AS is_default` (or `SELECT *, (is_default)::int AS is_default` relying on last-column-wins per Bun's object mapping — prefer the explicit column list to avoid duplicate-key ambiguity). INSERT binds `${makeDefault}` (a JS boolean) for `is_default`; `RETURNING id, user_id, label, ..., (is_default)::int AS is_default`. PATCH: `next.is_default` becomes a boolean; `WHERE id = ${existing.id} RETURNING ... (is_default)::int AS is_default`. List `ORDER BY is_default DESC, id ASC` stays valid (BOOLEAN sorts true>false, matching 1>0). Keep every response field and 404 behavior. Change `Database`→`SQL`; `AddressRow.is_default` stays `number`.
      Files: src/api/addresses.ts
      Verify: covered by step 11 commerce.test.ts (create address is_default:true returns, list only owner's, cross-user 404 patch/delete).

- [ ] 10. Convert `src/api/orders.ts` to async Bun.sql, including the transactional checkout and cancel.
      Keep `PAISE_PER_POINT`, `PAISE_PER_EARNED_POINT`, `parseSqlTime` (ISO strings unchanged), and all money/points math byte-for-byte. `toOrderView` → async: `await database\`SELECT * FROM order_items WHERE order_id = ${order.id} ORDER BY id ASC\``. Checkout handler → `async`: wrap the body in `await database.begin(async (tx) => { ... })` (replaces `database.transaction(()=>...)()`), using `tx` for every statement inside; re-read lines, validate stock, compute subtotal/clamp/total/earned exactly as now, `tx\`UPDATE books SET stock = stock - ${line.quantity} WHERE id = ${line.book_id}\``, `tx\`UPDATE users SET gift_points = gift_points - ${points_redeemed} + ${points_earned} WHERE id = ${userId}\``, `const [order] = await tx\`INSERT INTO orders (...) VALUES (${userId}, ${JSON.stringify(address)}, 'paid', ${body.payment_method ?? 'MOCK'}, ${subtotal_cents}, ${points_redeemed}, ${points_earned}, ${total_cents}, ${placed_at}, ${cancellable_until}) RETURNING *\``, loop `order_items` inserts, `tx\`DELETE FROM cart_items WHERE cart_id = ${cart.id}\``, return order. Keep `CheckoutError` → status mapping; since `begin` rolls back on throw, catch outside and map `CheckoutError.status`/message (throwing inside the callback triggers ROLLBACK, then rethrows — catch it in the handler). GET list → `ORDER BY placed_at DESC, id DESC` (drop SQLite `datetime(placed_at)`; ISO strings sort chronologically lexically). GET `/:id` 404 unchanged. Cancel → async, `await database.begin`: restore stock, refund `+ points_redeemed - points_earned`, `UPDATE orders SET status='cancelled' WHERE id=${order.id} RETURNING *`; keep the 404/409/403 logic and `parseSqlTime` window check. Buy-again → async, same cart-merge logic with Bun.sql + `database.begin`. Change `Database`→`SQL`.
      Files: src/api/orders.ts
      Verify: covered by step 11 commerce.test.ts (checkout paid+clamp+earn, stock decrement+cart cleared, points updated, empty-cart 400, unowned-address 404, over-balance clamp, order history newest-first, buy-again, cancel restores stock/refunds, >48h cancel 403, cross-user 404s).

- [ ] 11. Rewrite all 5 test files to run against Postgres with per-run cleanup.
      Replace `new Database(":memory:")` + PRAGMA + sync `initSchema/seedIfEmpty` with: `const db = openDb(process.env.TEST_DATABASE_URL ?? undefined)` (defaults to the real `booksonline` — acceptable per task if cleaned up). In `beforeAll` (now async): `await initSchema(db); await db\`TRUNCATE order_items, orders, cart_items, carts, addresses, users RESTART IDENTITY CASCADE\`;` then seed where the test needs catalogue (`await seedIfEmpty(db)`). For books/recommendations tests that assume `books/1` and stable ids, TRUNCATE `books RESTART IDENTITY CASCADE` too before `seedIfEmpty` so ids are deterministic. Convert every inline `db.query(...).get()/.all()` and `db.run(...)` assertion to `await db\`...\``; coerce counts with `Number()`. Replace the SQLite-only `datetime('now','+48 hours')` in recommendations.test.ts `seedOrder` and the commerce >48h setup with JS-computed ISO strings bound as params. `afterAll` (async): `await db\`TRUNCATE order_items, orders, cart_items, carts, addresses, users, books RESTART IDENTITY CASCADE\`;` then `await db.end()` (replaces `db.close()`). Make the auth.test "provisions a cart row" and all synchronous `db.query` assertions async. Each test file must be self-contained and not depend on another file's leftover rows (TRUNCATE in beforeAll guarantees this).
      Files: src/db/db.test.ts, src/api/auth.test.ts, src/api/books.test.ts, src/api/commerce.test.ts, src/api/recommendations.test.ts
      Verify: `bun test` — all 54 tests pass against Postgres (see step 13).

- [ ] 12. Update `src/server.ts` to await init.
      Change `initDb();` → `await initDb();` at top level (top-level await is supported in Bun ESM). Update the stale comment mentioning `store.sqlite`. Everything else (routes, port) unchanged.
      Files: src/server.ts
      Verify: part of step 14 live boot.

- [ ] 13. Full static + test verification against the real Postgres.
      Preconditions: Postgres running at localhost:5432, db `booksonline` exists (confirmed by task). Run in order from the workspace root:
      1. `bun install` (no new deps expected; confirms lockfile intact).
      2. `bunx tsc --noEmit` — zero errors.
      3. `bun test` — all 54 tests green.
      Files: (none — verification only)
      Verify: all three commands exit 0; `bun test` reports 54 pass / 0 fail. If `tsc` flags `SQL` typing, ensure `bun-types` is in `tsconfig` types (it is) and import `SQL` from `"bun"`.

- [ ] 14. Live end-to-end smoke test against Postgres, then confirm persistence (Windows/PowerShell).
      Start the server in the background on a test port, probe, stop it. Use ONLY `Invoke-RestMethod` (JSON) and `Invoke-WebRequest -UseBasicParsing` (status); never `curl`. Suggested flow:
      - `$env:PORT=3999; $p = Start-Process bun -ArgumentList 'run','src/server.ts' -PassThru -WindowStyle Hidden` (or `Start-Job`); wait ~2s.
      - `Invoke-WebRequest -UseBasicParsing http://localhost:3999/api/health` → 200 `{status:ok}`.
      - `Invoke-RestMethod http://localhost:3999/api/books` → non-empty `items`, numeric `total` (NOT a string — proves count coercion).
      - Register → login → add to cart → create address → checkout (mock pay) → GET /orders: assert the success path and that `payment_method=MOCK`, `status=paid`, `isCancellable=true`, numeric money fields.
      - Stop the server: `Stop-Process -Id $p.Id` (or `Stop-Job`/`Remove-Job`). Clear `$env:PORT`.
      - Persistence check: with the server stopped, query Postgres directly via a throwaway Bun one-liner using `Bun.sql` against `booksonline` (`SELECT COUNT(*)::int FROM books` ≥ 23, and the just-created user/order rows exist). Delete any temp script afterward.
      Files: (none — verification only; delete any temp probe scripts/background jobs created)
      Verify: health 200, books total is a JSON number, full purchase flow returns the documented shapes, and rows persist in Postgres after the server stops.

- [ ] 15. Update docs and ignore rules.
      README.md: replace the "Database" section — Postgres via `Bun.sql`, document `DATABASE_URL` (default `postgres://postgres:password@localhost:5432/booksonline`) and `TEST_DATABASE_URL`, state that a running Postgres server and the `booksonline` database are prerequisites, remove the `store.sqlite`/WAL/in-memory sentences; update the "Stack" bullet from "Bun's native SQLite" to "PostgreSQL via Bun's built-in `Bun.sql`". `.gitignore`: the `*.sqlite*` lines may stay harmlessly; optionally drop `store.sqlite`/`*.sqlite*` — do not remove `node_modules/`, `.env`, `dist/`. `package.json`: only touch if a script genuinely needs it (none expected — do NOT add Node tooling, Vite, Webpack, or an ORM).
      Files: README.md, .gitignore, package.json (only if needed)
      Verify: README no longer mentions SQLite as the datastore; `bun test` and `bunx tsc --noEmit` still green (re-run if package.json changed).

## Verification checklist (summary)
- [ ] `bun install` clean
- [ ] `bunx tsc --noEmit` zero errors
- [ ] `bun test` 54/54 pass against Postgres
- [ ] Live e2e purchase flow via `Invoke-RestMethod` returns documented shapes; money fields numeric (count coercion proven)
- [ ] Data persists in `booksonline` after the server stops
- [ ] No frontend file changed; API contract identical; no Node/Vite/Webpack/ORM added

## Risks / notes
- `Bun.sql` nested-fragment composition for the `/books` dynamic WHERE can be fiddly; the plan sanctions `sql.unsafe(text, paramsArray)` with positional `$1..$n` as a fully-parameterized fallback (no user input interpolated) if tagged-fragment composition is awkward. Either way, injection safety is preserved.
- Postgres returns `COUNT`/bigint as strings — the `::int` casts and `Number()` coercions are mandatory, else `total`/`count` leak as strings and break the contract.
- Tests default to the real `booksonline` DB when `TEST_DATABASE_URL` is unset; the `TRUNCATE ... RESTART IDENTITY CASCADE` in before/after guarantees isolation and deterministic ids. If a separate test DB is available, set `TEST_DATABASE_URL` to use it.
