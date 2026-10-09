# Verification — bun:sqlite → PostgreSQL (Bun.sql) migration

First iteration (no `migration-review.json` present). Full migration from
`plan.md` implemented. All verification run from the workspace root
`c:\Users\PravallikaP\Documents\FDE capstone\online_bookstore` against the
local PostgreSQL 18.6 server (`localhost:5432`, db `booksonline`, user
`postgres`). No external driver, ORM, or Node tooling was added — the data
layer uses Bun's built-in `import { SQL } from "bun"` client.

## Static checks

| Command | Result |
| --- | --- |
| `bun install` | `Checked 112 installs across 143 packages (no changes)` — lockfile intact, nothing Node-based added |
| `bunx tsc --noEmit` | `TSC_EXIT=0` — 0 errors |
| `bun test` | `54 pass / 0 fail`, `Ran 54 tests across 5 files` — all green against Postgres |

Source grep confirms no residual SQLite: `bun:sqlite`, `store.sqlite`,
`new Database(`, `PRAGMA`, `DB_PATH` → **no matches** in `src/**/*.ts`.

## Connection config

- Centralized in `src/db/index.ts`. Reads `DATABASE_URL`; documented default
  when unset is exactly `postgres://postgres:password@localhost:5432/booksonline`
  (`DEFAULT_DATABASE_URL`). Tests honor `TEST_DATABASE_URL`, falling back to the
  default. No credentials scattered elsewhere.
- `initDb()` is async: `await initSchema()` then `await seedIfEmpty()`.

## Live end-to-end (server on PORT=3200, driven with fetch; PowerShell probes
used `Invoke-RestMethod` / `Invoke-WebRequest -UseBasicParsing`, never curl)

Observed results:

- Root `/` HTML → **200**.
- `GET /api/health` → `{ status: ok }`.
- `GET /api/books` → `total=23` returned as a **JSON number** (Int32), 12 items
  on page 1, `pageSize=12` (COUNT bigint→number coercion proven).
- `GET /api/categories` → **7**; `GET /api/publishers` → **21**.
- Unauthenticated `GET /api/cart` → **401**.
- register (welcome `gift_points=0`) → login (JWT) → `GET /api/auth/me` →
  `GET /api/auth/points`.
- add cart item (numeric `subtotal_cents`) → add address (`is_default`
  returned as numeric **1**) → checkout `POST /api/orders` →
  `status=paid`, `payment_method=MOCK`, `points_earned=13`
  (`floor(136000/10000)`), `total_cents` non-negative, `isCancellable=true`.
- stock decremented 5 → 3.
- `GET /api/orders` lists it (newest first); buy-again re-adds to cart;
  `GET /api/recommendations` → `source=history`, non-empty.
- cancel within window → **200**, `status=cancelled`.
- Backdated order (placed_at / cancellable_until > 48h in the past, inserted
  directly into Postgres) → cancel endpoint → **403** "Cancellation window
  expired"; order remained `paid`.
- Cross-user isolation: user B sees empty cart/orders/addresses and 0 points;
  B cannot read/cancel A's order or patch A's address (all **404**).

## Persistence (server stopped, queried Postgres directly via Bun.sql)

With the server down: `books=23`, created user/order rows present, the
cancelled order persisted as `status=cancelled`, `payment_method=MOCK`. Data
survives process shutdown — true PostgreSQL persistence, no browser/in-memory
state. FK enforcement confirmed (deleting a user while its auto-provisioned
cart existed raised `carts_user_id_fkey`).

## Cleanup

Server stopped (0 listeners on 3200). All throwaway probe scripts and the
obsolete `store.sqlite*` files removed. Test-created commerce rows cleaned; DB
left with only the seeded catalogue (`users=0 orders=0 books=23`). No frontend
file changed (`git status -- src/frontend` → 0). Working tree carries only the
intended migration edits — NOT committed/pushed, left for review.
