# BooksOnline

An e-commerce platform to view, browse, and purchase books. Built 100% on the
Bun ecosystem — no Node.js, Vite, or Webpack.

## Stack

- **Runtime & bundler:** Bun (built-in Fullstack Dev Server via HTML imports + `Bun.serve()`)
- **Frontend:** React 19 + Tailwind CSS v4 + shadcn/ui (new-york, neutral, CSS variables) with `lucide-react` icons
- **Backend:** ElysiaJS REST API mounted under `/api`
- **Database:** PostgreSQL via Bun's built-in SQL client (`import { SQL } from "bun"`), no external driver or ORM
- **Auth:** real JWT auth with `Bun.password` (argon2id) hashing; per-user data isolation enforced server-side

One `Bun.serve()` process serves the bundled SPA and the Elysia API on a single
port. The frontend is a hash-based single-page app (no server-side route table).

## Getting started

```sh
bun install
bun dev
```

The app runs on http://localhost:3000 (override with the `PORT` env var). `bun dev`
is a single command on a single port that serves both the React app and the API.

### Scripts

- `bun dev` — start the dev server with hot reload (one command, one port)
- `bun start` — start the server (production-style, no hot reload)
- `bun test` — run the full test suite
- `bun run typecheck` — type-check with `tsc --noEmit`

### Environment

- `PORT` — HTTP port (default `3000`).
- `DATABASE_URL` — PostgreSQL connection string. When unset, the documented
  default `postgres://postgres:password@localhost:5432/booksonline` is used.
- `TEST_DATABASE_URL` — connection string the test suite uses. When unset, the
  tests fall back to `DATABASE_URL`/the default above; point this at a separate
  database if you don't want tests sharing the primary one.
- `JWT_SECRET` — secret used to sign/verify JWTs. If unset, a documented dev
  fallback constant (`dev-only-insecure-secret-change-me`) is used so the app
  runs out of the box. **Set a real `JWT_SECRET` in production** — the dev
  fallback is insecure and intended only for local development.

### Database

The app stores all data in **PostgreSQL**, accessed through Bun's built-in SQL
client (`import { SQL } from "bun"`) — no external driver, ORM, or Node tooling.
A running PostgreSQL server and a database named `booksonline` are
prerequisites; the app connects via `DATABASE_URL` (default
`postgres://postgres:password@localhost:5432/booksonline`). All connection
configuration is centralized in `src/db/index.ts`.

On the first server run the schema is created and a sample catalogue of popular
books (priced in INR) is seeded. Both steps are idempotent (`CREATE TABLE IF
NOT EXISTS`; seeding only when the catalogue is empty), so subsequent boots are
no-ops. The test suite applies the same schema/seed and TRUNCATEs its tables
before and after each run, so it never leaves residual rows.

## Money & gift points

All monetary values are stored as **integer paise** (`*_cents` columns; ₹1 = 100
paise) and rendered everywhere in the UI with the ₹ symbol via `formatINR`.

Gift points policy:

- **Redemption:** 1 gift point = ₹1 off the subtotal (`PAISE_PER_POINT = 100`).
  Redemption is clamped server-side to the user's balance and to the subtotal, so
  the total can never go negative.
- **Earning:** 1 point per ₹100 actually paid (`points_earned = floor(total_cents / 10000)`).
- **Welcome bonus:** none. New accounts start at 0 points; points accrue purely
  from purchases. On cancellation within the window, redeemed points are refunded
  and earned points reversed.

## Payment (fully mocked)

There is **no payment gateway and no payment-method selection**. Checkout shows a
"Payment required" card with the amount due in ₹ and two buttons:

- **Pay** → `POST /api/orders` creates the order with status `paid` and
  `payment_method = MOCK`, then navigates to the confirmation screen.
- **Cancel Payment** → aborts checkout, creates **no** order, and returns to the
  cart.

On a successful payment, the confirmation screen shows exactly:

> The product has been purchased successfully and will be delivered soon

## Customer-journey features

The storefront wires every backend endpoint into real, interactive screens
(sticky nav, lucide icons, no emojis, overlays conditionally rendered):

1. **Browse entry points** — hero and category links lead into the catalogue.
2. **Recommendations** — personalised "Recommended for you" when logged in
   (`GET /api/recommendations`), popular fallback otherwise.
3. **Order history preview + Buy It Again** — recent orders on Home with a
   one-click re-add to cart (`POST /api/orders/:id/buy-again`).
5. **Catalogue search & filter** — search by title/author, filter by category
   and publisher (brands), price range, sort (price/title/newest), pagination
   (`GET /api/books`, `/api/categories`, `/api/publishers`).
6. **Catalogue browsing** — responsive grid of book cards with cover, title,
   author, ₹ price, and rating.
7. **Book detail** — full description, ₹ price, stock status, category,
   publisher, and the tentative **delivery date** (`GET /api/books/:id`).
8. **Add to cart & related products** — quantity-aware add to cart (disabled when
   out of stock) and a related-products row.
9. **Delivery address** — list/select saved addresses and add new ones via a
   dialog (`GET`/`POST /api/addresses`); a selected address is required to pay.
10. **Gift points redemption** — redeem points at checkout with a live ₹ preview
    (the server recomputes the authoritative total).
11. **Mocked payment** — the Pay / Cancel Payment card described above.
12. **Confirmation & cancellation** — the exact success message, the order
    summary (items, ₹ totals, points redeemed/earned, address snapshot), and a
    Cancel action enabled only within 48h. Cancellation is enforced
    server-side (`POST /api/orders/:id/cancel`); the UI reflects the server's
    `isCancellable` and surfaces the server's rejection message outside the
    window.

Order history (`/orders`) lists every order with status badges, ₹ totals, Buy It
Again, and an in-window Cancel action backed by the same server endpoint.

## API

All endpoints are under `/api` and return a consistent JSON error shape
`{ error: string }`. Protected routes require `Authorization: Bearer <jwt>`.

- **Auth:** `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `GET /auth/points`
- **Catalogue:** `GET /books`, `GET /books/:id`, `GET /categories`, `GET /publishers`
- **Recommendations:** `GET /recommendations` (auth)
- **Cart:** `GET /cart`, `POST /cart/items`, `PATCH /cart/items/:id`, `DELETE /cart/items/:id` (auth)
- **Addresses:** `GET /addresses`, `POST /addresses`, `PATCH /addresses/:id`, `DELETE /addresses/:id` (auth)
- **Orders:** `POST /orders`, `GET /orders`, `GET /orders/:id`, `POST /orders/:id/cancel`, `POST /orders/:id/buy-again` (auth)

## Testing on Windows / PowerShell

Use `Invoke-RestMethod` for JSON and `Invoke-WebRequest -UseBasicParsing` to
check HTTP status. Do not use `curl`. When booting the server for a manual probe,
run it in the background (`Start-Process` / `Start-Job`) and stop it afterward
rather than blocking the foreground.
