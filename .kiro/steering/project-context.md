---
Inclusion: always
---

# Project Context

## Overview
**BooksOnline** is a full-stack e-commerce bookstore built as a capstone project. It lets customers browse a catalogue, manage a shopping cart, place orders, and track purchases — with gift-point loyalty rewards and a 48-hour cancellation window.

Target users: individual book buyers (B2C retail).

## Technology Stack
| Layer | Technology |
|---|---|
| Runtime / bundler | Bun 1.4.2 |
| Frontend framework | React 19 |
| Styling | Tailwind CSS v4 + shadcn/ui (new-york theme, neutral palette, CSS variables) |
| HTTP framework | ElysiaJS |
| Database driver | Bun.sql (built-in PostgreSQL client) |
| Database | PostgreSQL 16 |
| Authentication | Hand-rolled HS256 JWT + Bun.password (argon2id) |
| Icons | lucide-react only (no emojis in UI) |
| Testing | bun:test |

## Key Architectural Decisions

### Single-Port Architecture
One `Bun.serve()` instance handles everything. ElysiaJS processes `/api/*`; the SPA is served for all other paths. This removes the need for a separate dev proxy and simplifies deployment.

### Bun.sql over External Drivers
`Bun.sql` is the built-in PostgreSQL client; it uses tagged-template literals for parameterised queries, eliminating a dependency on `pg` or `postgres.js` and enabling idiomatic SQL without an ORM.

### Hand-Rolled JWT
A minimal HS256 JWT implementation in `src/lib/auth.ts` keeps the auth layer transparent and dependency-free. `authGuard` always re-fetches the user from the database to pick up revocations and role changes.

### Hash Router
The React SPA uses a hash router (`#/path`) so that `Bun.serve` does not need catch-all route logic for deep links — every path serves `index.html` and the hash is resolved client-side.

### Idempotent Seed
`src/db/seed.ts` uses `INSERT ... ON CONFLICT DO NOTHING` so it is safe to re-run without duplicating data.

## Money Convention
- Stored as **integer paise** (1 INR = 100 paise). All `*_cents` columns are `INTEGER`.
- Displayed with the `formatINR(paise: number): string` helper which divides by 100 and prepends `₹`.
- **Never store money as a float** — floating-point arithmetic introduces rounding errors.

## Gift Points Policy
- Earn rate: `floor(total_order_paise / 10000)` points per order (1 point per ₹100 spent).
- Redemption: 1 point = ₹1 = 100 paise off the order total.
- Welcome balance: 0 points.
- Points are refunded (restored) when an order is cancelled.

## Payment
- Fully **mocked**: every payment succeeds instantly with `status: 'paid'`, `method: 'MOCK'`.
- No real payment gateway is integrated.
- Success message displayed to user: _"The product has been purchased successfully and will be delivered soon."_

## Customer Journey Features
1. **Authentication** — register, login, logout (JWT).
2. **Order history** — list past orders with status badges.
3. **Buy-again** — re-add a past order's items to the cart in one click.
4. **Recommendations** — personalised suggestions based on order history.
5. **Catalogue** — browse and filter by category and publisher.
6. **Book detail** — title, author, price, expected delivery date, related books.
7. **Shopping cart** — add, update quantity, remove items.
8. **Address selection** — saved addresses; select at checkout.
9. **Gift points** — earn on purchase; redeem at checkout.
10. **Mocked payment** — one-click checkout with MOCK payment.
11. **Order confirmation** — success message after purchase.
12. **48-hour cancellation** — cancel orders within the `cancellable_until` window.

## Development Commands
```bash
bun install        # install dependencies
bun dev            # start dev server (API + SPA on one port)
bun test           # run test suite (bun:test)
bunx tsc --noEmit  # type-check without emitting
```

## Environment Variables
| Variable | Purpose | Dev default |
|---|---|---|
| `PORT` | Server listen port | `3000` |
| `DATABASE_URL` | PostgreSQL connection string | `postgres://postgres:password@localhost:5432/booksonline` |
| `TEST_DATABASE_URL` | Separate DB for tests | `postgres://postgres:password@localhost:5432/booksonline_test` |
| `JWT_SECRET` | HMAC signing secret | `dev-only-insecure-secret-change-me` (insecure) |

## Git Branches
- `main` — legacy SQLite version (archived reference).
- `pg-db` — active PostgreSQL version; all new work goes here.

## Logo
`https://kiro.dev/images/community/events/thumbnails/meetup2.svg`
