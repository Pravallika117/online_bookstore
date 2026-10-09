# Implementation Plan — BooksOnline (Bun-native full-stack bookstore)

Greenfield build at `c:\Users\PravallikaP\Documents\FDE capstone\online_bookstore`. Stack: ONE `Bun.serve()` on ONE port serving an ElysiaJS REST API under `/api/*` and a React 19 + Tailwind v4 + shadcn/ui (new-york) client bundled via Bun HTML imports. Persistence: `bun:sqlite` at `store.sqlite` (auto schema + seed on first run). Auth: real JWT with `Bun.password` hashing, strict per-user isolation. NO Node.js/Vite/Webpack/esbuild. Windows/PowerShell: use `Invoke-RestMethod` / `Invoke-WebRequest -UseBasicParsing`, never `curl`; never run a blocking foreground server — background/bounded then stop.

Key decisions (made during exploration, grounded in Bun 1.4.2 docs):
- Wiring: `Bun.serve({ routes: { '/*': indexHtml }, fetch(req){ if /api -> elysia.fetch(req) } })`. HTML imports bundle the SPA; Elysia handles `/api/*`. One process, one port — satisfies the single-server constraint without any bundler. (Bun fullstack docs.)
- Tailwind: `bun-plugin-tailwind` in `bunfig.toml [serve.static]` as the brief mandates (the Bun-documented path).
- Money: all amounts stored as integer paise in the existing `*_cents` columns; UI formats as `₹`. Payment is FULLY MOCKED (Pay / Cancel Payment card; order created `paid`; exact success text); `payment_method` defaults to `'MOCK'`; no gateway, no payment-method selection.

Full details, acceptance criteria, and per-feature verification live in the FEAT artifacts under `.agents/tasks/booksonline/features/`. This file is the ordered fallback checklist.

- [ ] 1. Scaffold + config + single-port server + Tailwind/shadcn (new-york) setup. (FEAT-001)
      Files: package.json, bunfig.toml, tsconfig.json (`@/*`), components.json, .gitignore, README.md (stub), src/server.ts, src/api/index.ts (health), src/frontend/{index.html,main.tsx,globals.css,App.tsx,lib/utils.ts,components/ui/*}
      Verify: `bun install` succeeds; `bunx tsc --noEmit` clean; boot background, `Invoke-WebRequest -UseBasicParsing http://localhost:3000/` → 200 HTML, `Invoke-RestMethod http://localhost:3000/api/health` → `{status:'ok'}`; stop server.

- [ ] 2. Database schema + thin query layer + auto-seed of real popular books in INR paise. (FEAT-002)
      Files: src/db/index.ts, src/db/schema.ts, src/db/seed.ts, src/db/db.test.ts
      Verify: `bun test src/db` passes (tables exist, >=4 categories, >=3 publishers, every book has cover_url + price_cents>0, seed idempotent); `bunx tsc --noEmit` clean.

- [ ] 3. Real auth: register/login/me, Bun.password hashing, JWT, reusable auth guard. (FEAT-003)
      Files: src/lib/auth.ts, src/api/auth.ts, src/api/auth.test.ts, (mount in src/api/index.ts)
      Verify: `bun test src/api/auth.test.ts` passes (register, duplicate 409, login, wrong-pw 401, /me 200 with token / 401 without, tampered token 401); `bunx tsc --noEmit` clean.

- [ ] 4. Catalogue API (books list with search/filter/sort/paging, categories, publishers, detail with tentative delivery date + related products) + history-based recommendations with popular fallback. (FEAT-004)
      Files: src/api/books.ts, src/api/recommendations.ts, src/api/books.test.ts, src/api/recommendations.test.ts, (mount in src/api/index.ts)
      Verify: `bun test` for both modules passes; boot + `Invoke-RestMethod` on /api/books (+filters/sort), /api/categories, /api/publishers, /api/books/1 (deliveryDate + relatedProducts), /api/recommendations (authed); stop server.

- [ ] 5. Commerce core: per-user cart, saved addresses, order checkout (mocked payment, gift-point redemption), order history, buy-again, backend-enforced cancel-within-48h, strict per-user isolation. (FEAT-005)
      Files: src/api/cart.ts, src/api/addresses.ts, src/api/orders.ts, src/api/commerce.test.ts, (mount in src/api/index.ts)
      Verify: `bun test src/api/commerce.test.ts` passes including the >48h cancel rejection (server-side, from stored timestamps) and user-A/user-B isolation; boot + `Invoke-RestMethod` purchase flow; stop server.

- [ ] 6. Full React storefront (home + recommendations + buy-again, catalogue, book detail, cart, checkout with mocked Pay/Cancel-Payment card, confirmation with exact success text + 48h cancel, orders, login/register), INR `₹` everywhere, lucide-react icons, specified logo, sticky nav, no emojis, no dead buttons; expand README. (FEAT-006)
      Files: src/frontend/lib/api.ts, src/frontend/context/auth.tsx, src/frontend/App.tsx, src/frontend/pages/{Home,Catalogue,BookDetail,Cart,Checkout,Confirmation,Orders,Login,Register}.tsx, README.md
      Verify: `bunx tsc --noEmit` clean; full `bun test` passes; `bun dev` serves one port, `Invoke-WebRequest -UseBasicParsing http://localhost:3000/` → 200 HTML; drive register→login→books→cart→address→order→confirmation→cancel via `Invoke-RestMethod`; README lists the journey features + mocked-payment success message + JWT env; stop server.

## Final integration verification (run after all features)
- `bun install` → `bunx tsc --noEmit` → `bun test` all green.
- Boot once (background/bounded): register a user, log in for a JWT, GET /api/books returns seeded books, /api/categories + /api/publishers return data, add a cart item, add an address, checkout (optionally redeeming points) → order shows in /api/orders, buy-again re-adds items, cancel within window succeeds, a constructed order with placed_at older than 48h is rejected server-side on cancel, /api/recommendations returns something sensible, and a SECOND user cannot see the FIRST user's cart/orders/addresses/points. Stop the server; delete any temp DB files; store.sqlite stays uncommitted.
