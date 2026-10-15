---
inclusion: auto
name: Project Context Summary
description: Current state, decisions, and status of BooksOnline — refer here instead of chat history
---

# BooksOnline Project Context

## Current State (October 14, 2026)

**Status:** Production-ready, fully documented, awaiting deployment decision.

**Repository:** https://github.com/Pravallika117/online_bookstore.git
- **Active branch:** `pg-db` (PostgreSQL, all new work)
- **Legacy branch:** `main` (SQLite, archived reference)
- **Local path:** `c:\Users\PravallikaP\Documents\FDE capstone\online_bookstore`

**Test results:** 54/54 passing (bun:test), 0 TypeScript errors (strict mode)

---

## What Is BooksOnline?

A full-stack e-commerce bookstore (capstone project) where customers:
1. Register / login with JWT auth
2. Browse a catalogue (filtered by category, publisher, searchable)
3. View book details (title, author, price in ₹, expected delivery, related books)
4. Add items to cart, manage quantities
5. Select a saved address or add new
6. Redeem gift points (earn floor(total/10000) points per order; 1 point = ₹1)
7. Checkout with mocked payment (instantly succeeds, status='paid', method='MOCK')
8. View order history with status badges
9. Re-add past orders to cart in one click (buy-again)
10. Cancel orders within 48 hours of purchase
11. Get personalised book recommendations based on purchase history
12. Enjoy default 12 books per page (max 100), sorted by title/price/newest

---

## Technology Stack

| Layer | Technology | Version | Notes |
|---|---|---|---|
| **Runtime** | Bun | 1.4.2 | Built-in Postgres client (Bun.sql), password hashing (argon2id), bundler |
| **Backend** | ElysiaJS | Latest | HTTP framework, REST API |
| **Frontend** | React | 19 | Functional components, hash router (#/path) |
| **Styling** | Tailwind CSS | v4 | CSS variables, neutral palette, new-york theme |
| **UI Components** | shadcn/ui | new-york | Button, Card, Dialog, Input, Select, Tabs, Badge, etc. |
| **Icons** | lucide-react | Latest | No emojis in UI |
| **Database** | PostgreSQL | 16 | Stateless, ECS-ready |
| **Database Driver** | Bun.sql | Built-in | Tagged templates, parameterised queries, no external driver |
| **Authentication** | JWT (HS256) | Custom | Hand-rolled in `src/lib/auth.ts`, 7-day TTL (604800s), Bun.password hashing |
| **Testing** | bun:test | Built-in | 5 test files, co-located as `*.test.ts` |

**Bun-native only:** No Node.js packages, no Vite, no Webpack, no Prisma, no external password libraries.

---

## Project Structure

```
src/
├── server.ts                 # Bun.serve() (one port, API + SPA)
├── lib/
│   └── auth.ts              # Hand-rolled JWT, Bun.password, authGuard plugin
├── api/
│   ├── index.ts             # Elysia instance, routes registration
│   ├── auth.ts              # /api/auth/* (register, login, me, logout)
│   ├── auth.test.ts         # 12 tests
│   ├── books.ts             # /api/books/* (search, filter, paginate, detail, related)
│   ├── books.test.ts        # 8 tests
│   ├── recommendations.ts   # /api/recommendations (personalised, fallback to popular)
│   ├── recommendations.test.ts # 3 tests
│   ├── cart.ts              # /api/cart/* (add, remove, update)
│   ├── addresses.ts         # /api/addresses/* (CRUD for saved addresses)
│   ├── orders.ts            # /api/orders/* (checkout, list, detail, cancel, buy-again)
│   └── commerce.test.ts     # 21 tests (checkout, 48h cancel, isolation)
├── db/
│   ├── index.ts             # Bun.sql connection, `database` export
│   ├── schema.ts            # 7 PostgreSQL tables (idempotent DDL)
│   ├── seed.ts              # 23 real books (INR paise pricing, Open Library covers)
│   └── db.test.ts           # 5 tests (schema, seed idempotent, 23 books)
└── frontend/
    ├── index.html           # React entry point (Bun HTML import)
    ├── globals.css          # Tailwind directives
    ├── App.tsx              # Hash router, auth/cart context providers
    ├── context/
    │   ├── auth.tsx         # Auth context (user, token, login, logout, register)
    │   └── cart.tsx         # Cart context (items, addItem, removeItem, updateQty)
    ├── lib/
    │   ├── api.ts           # Centralised fetch wrapper (all API calls)
    │   ├── router.tsx       # Hash router, page routes
    │   └── utils.ts         # Helpers (formatINR, validateEmail, validatePassword)
    ├── components/
    │   ├── book-card.tsx    # Book preview card (title, author, price, rating badge)
    │   ├── nav.tsx          # Navigation (logo, search, cart link, auth buttons)
    │   └── ui/              # shadcn/ui components (Button, Card, Input, etc.)
    └── pages/               # Route pages (Home, Catalogue, Book Detail, Cart, Checkout, Orders, etc.)

.kiro/
├── steering/
│   ├── project-context.md           # Full feature spec, money convention, env vars, git branches
│   ├── coding-standards.md          # TypeScript strict, naming, JSDoc, React (functional), testing
│   ├── best-practices.md            # Bun-native, single-port, RESTful API, Bun.sql, pagination
│   └── security.md                  # JWT + DB reload, ownership checks, password_hash never in response
└── hooks/                           # (Optional) Agent automation hooks

.agents/tasks/booksonline/           # Workflow artifacts (plans, reviews, verification notes)
├── features/                        # FEAT-001 through FEAT-006 (scaffolding, schema, auth, API, commerce, frontend)
├── plan.md                          # Implementation plan from workflow
├── review.json                      # Code review verdict
├── test-report.md                   # Test results and coverage
└── verification.md                  # Final verification checklist

DEPLOYMENT.md                        # 770 lines, 15-step AWS ECS + RDS + ALB deployment guide
architecture.svg                     # Full-stack diagram (client → Bun.serve → auth → API modules → DB)
```

---

## Database Schema

**7 Tables (PostgreSQL 16):**

1. **users** — email, password_hash, name, total_spent_paise, gift_points_balance
2. **books** — title, author, category, publisher, description, price_paise, cover_url, isbn
3. **cart_items** — user_id, book_id, quantity
4. **addresses** — user_id, street, city, postal_code, country (+ timestamps)
5. **orders** — user_id, total_paise, status (pending/confirmed/cancelled), created_at, cancellable_until
6. **order_items** — order_id, book_id, quantity, price_paise_at_purchase
7. **payments** — order_id, status (paid/failed), method (MOCK), paid_at

**Indexes:** Foreign keys (user_id, order_id, book_id), high-cardinality filters (category, publisher)

**Money:** Stored as INTEGER paise (1 INR = 100 paise). Never float.

**Seed data:** 23 real books (₹100–₹999), Open Library covers, idempotent `INSERT ... ON CONFLICT DO NOTHING`

---

## Key Decisions Made

| Decision | Chosen | Rationale |
|---|---|---|
| **Database** | PostgreSQL (Bun.sql) | Stateless, horizontally scalable, ECS-ready. Rejected SQLite (not scalable). |
| **Postgres driver** | Bun.sql (built-in) | 100% Bun-native. Rejected postgres.js npm package (external dependency). |
| **Authentication** | Hand-rolled JWT (HS256) | Transparent, minimal deps. Token always re-verified in DB (authGuard). TTL 7 days. |
| **Password hashing** | Bun.password (argon2id) | Bun-native. Rejected bcrypt (Node.js package). |
| **Frontend bundler** | Bun HTML imports + bun-plugin-tailwind | Single-port SPA serving. Rejected Vite/Webpack (Node.js ecosystem). |
| **Router** | Hash router (#/path) | No catch-all needed; every path serves index.html. |
| **Payment** | Fully mocked | Capstone scope. Status='paid', method='MOCK'. Success message exact. Can add real gateway later. |
| **Money storage** | INTEGER paise | No rounding errors. Display with formatINR helper. |
| **Testing** | bun:test (co-located *.test.ts) | No external test framework. Tests run with `bun test`. |
| **AWS deployment** | ECS Fargate + RDS + ALB | Production-grade, auto-scaling, cost-effective (~$63–75/month). Documented in DEPLOYMENT.md. |
| **Git branches** | `main` (SQLite legacy), `pg-db` (PostgreSQL active) | User's preference: keep legacy as reference, active work on pg-db. |

---

## Money Convention

- **Storage:** INTEGER paise (e.g., ₹100 = 10000 paise)
- **Display:** `formatINR(paise: number): string` helper (divides by 100, prepends ₹)
- **Gift points:** Earn floor(total_order_paise / 10000) per order; 1 point = 100 paise off total
- **Never float:** Floating-point arithmetic causes rounding errors in payments

---

## Gift Points Policy

- **Earn rate:** floor(total_order_paise / 10000) points per order (1 point per ₹100 spent)
- **Redemption:** 1 point = ₹1 = 100 paise off the order total
- **Welcome balance:** 0 points
- **Cancellation:** Points refunded when order is cancelled

---

## Payment (Mocked)

- **Status:** Always 'paid' (instant success)
- **Method:** 'MOCK' (not a real gateway)
- **Success message:** _"The product has been purchased successfully and will be delivered soon."_
- **No credentials stored:** This is intentional for a capstone project

---

## Authentication Flow

1. **Register:** POST `/api/auth/register` with email, password (min 8 chars), name
   - Validates email format, password strength, unique email
   - Returns JWT + user object (no password_hash)
2. **Login:** POST `/api/auth/login` with email, password
   - Returns JWT + user object
3. **Token usage:** `Authorization: Bearer <token>` header
4. **Me endpoint:** GET `/api/auth/me` (requires auth) — returns current user
5. **Logout:** POST `/api/auth/logout` (client-side: clear localStorage)

**Security:**
- JWT TTL: 7 days
- authGuard always re-fetches user from DB (never trusts token payload)
- password_hash never in response
- Token stored client-side (localStorage or in-memory)

---

## Ownership & Isolation

Every authenticated route checks `AND user_id = ${userId}` in the query.
Foreign resource ID → 404 (not 403), to avoid leaking existence of other users' resources.

**Tested:** `commerce.test.ts` includes cross-user isolation checks (user A cannot see/cancel user B's orders).

---

## 48-Hour Cancellation Window

- **Enforcement:** Server-side timestamp `cancellable_until` (order.created_at + 48h)
- **Client never supplies this value**
- **Cancel endpoint:** PUT `/api/orders/:id/cancel` checks `Date.now() <= cancellable_until`
- **Response:** 200 on success, 403 if outside window, 404 if order not found

---

## Environment Variables

| Variable | Purpose | Dev Default | Production |
|---|---|---|---|
| `PORT` | Server listen port | 3000 | 3000 (or ALB target port) |
| `DATABASE_URL` | PostgreSQL connection | `postgres://postgres:password@localhost:5432/booksonline` | AWS Secrets Manager |
| `TEST_DATABASE_URL` | Test DB (isolated) | `postgres://postgres:password@localhost:5432/booksonline_test` | CI/CD Secrets Manager |
| `JWT_SECRET` | HMAC signing secret | `dev-only-insecure-secret-change-me` (insecure, warns at startup if not dev) | Strong random secret (AWS Secrets Manager) |
| `NODE_ENV` | Environment (development/production) | development | production |

**Startup warning:** If `NODE_ENV !== 'development'` and `JWT_SECRET` is the dev fallback, console.warn fires.

---

## Development Commands

```bash
bun install              # Install dependencies
bun dev                  # Start dev server (API + SPA on http://localhost:3000)
bun test                 # Run all tests (bun:test)
bunx tsc --noEmit        # Type-check (strict mode, 0 errors expected)
```

**No separate frontend dev server.** Bun handles SPA serving + API hot-reload.

---

## Deployment Options

### Option 1: AWS ECS Fargate + RDS (Recommended for Production)
**Cost:** ~$63–75/month (or free during 12-month free tier if staying under RDS 750h/month)
**Setup:** 15 steps documented in DEPLOYMENT.md (ECR, IAM, Secrets Manager, ALB, auto-scaling 2–10 tasks)
**Pros:** Production-grade, horizontal scaling, managed database, CloudWatch monitoring
**Cons:** Complexity, cost after free tier

### Option 2: AWS Lambda + RDS (Free Tier Eligible)
**Cost:** $0 (first 1M Lambda requests/month free, 20 GB RDS free)
**Setup:** Wrap Bun server in Lambda handler, API Gateway + RDS
**Pros:** Truly free, serverless
**Cons:** Cold starts (2–3 sec), slower Bun startup, not ideal for real-time checkout

### Option 3: GCP Cloud Run (Cheapest for Typical Traffic)
**Cost:** $0 (first 2M requests/month free, Cloud SQL PostgreSQL free tier eligible)
**Setup:** Container image on Cloud Run, Cloud SQL PostgreSQL
**Pros:** No cold starts, simpler than AWS, truly free for capstone demo
**Cons:** Switching clouds from AWS

### Option 4: DigitalOcean App Platform (Simple & Cheap)
**Cost:** ~$12/month (all-in for app + managed PostgreSQL)
**Setup:** Push to GitHub, connect to DigitalOcean, auto-deploy
**Pros:** Simplest setup, cheap, no cold starts
**Cons:** Less control than ECS

---

## Known Gaps & Future Work

1. **Rate limiting:** `/api/auth/login` and `/api/auth/register` have no rate limiting (flagged in security steering). Add IP-based sliding-window middleware before production.
2. **Real payment gateway:** Currently mocked. Can integrate Razorpay, Stripe, or similar later.
3. **Email notifications:** No order confirmation emails (can add later).
4. **Admin dashboard:** No admin UI for inventory management (can add later).
5. **Search indexing:** Full-text search on book titles/authors (can add Elasticsearch later).
6. **Caching:** No Redis caching (can add for high-traffic scenarios).

---

## Git Workflow

**Branch:** `pg-db` (active, PostgreSQL)
**Main branch:** `main` (archived SQLite legacy)

**Commits (recent, pg-db):**
- `93b1ecc` — docs: add AWS deployment guide (ECS + RDS + ALB)
- `191f9fb` — fix: apply coding standards and security fixes from steering audit
- `ffa8b0f` — docs: add coding standards, best practices, security, and project-context steering files
- `c396fb7` — docs: add migration review, test report, and verification notes
- `fa823de` — feat: migrate database from bun:sqlite to PostgreSQL via Bun.sql

**Workflow artifacts:** `.agents/tasks/booksonline/` (FEAT-001–006, plans, reviews, verification)

---

## Tests Summary

**54/54 passing** (bun:test), 128 expect() assertions

| File | Tests | Coverage |
|---|---|---|
| auth.test.ts | 12 | register, login, token validation, me endpoint, 409 dup, 401 invalid |
| books.test.ts | 8 | search, filter by category/publisher, sort, pagination, detail, related books |
| recommendations.test.ts | 3 | personalised (from history), fallback to popular, auth-required |
| commerce.test.ts | 21 | checkout (cart → order), 48h cancel (403 after window), cross-user isolation, buy-again |
| db.test.ts | 5 | schema creation, seed idempotency, 23 books loaded, cover_url + price_paise validated |

**Type safety:** TypeScript strict mode, `bunx tsc --noEmit` = 0 errors

---

## Security Checklist

✅ JWT with DB re-verification (authGuard)
✅ password_hash never in response
✅ Ownership checks on all user resources (AND user_id)
✅ Foreign resource ID → 404 (not 403)
✅ SQL injection prevention (Bun.sql tagged templates + ORDER BY allowlist)
✅ Input validation (Elysia t.Object schema on all endpoints)
✅ 48-hour cancellation enforced server-side
✅ Gift-point redemption clamped server-side
✅ Atomic transactions (database.begin()) for checkout/cancel
❌ Rate limiting on auth endpoints (known gap, add before prod)

---

## Steering Files in `.kiro/steering/`

1. **project-context.md** — Full feature spec, money convention, env vars, git branches
2. **coding-standards.md** — TypeScript strict, naming, JSDoc, React (functional only), error handling
3. **best-practices.md** — Bun-native, single-port, RESTful API, Bun.sql, pagination, git hygiene
4. **security.md** — JWT + DB reload, ownership checks, password security, SQL injection prevention, rate limiting gap

**These files auto-load in every Kiro session** (inclusion: always).

---

## How to Use This Document

- **Before starting a task:** Read the relevant section (Architecture, Stack, Decisions, Security)
- **When asking for help:** Reference specific sections rather than asking to "re-read chat history"
- **When reporting a bug:** Check the section relevant to the component (Auth Flow, Money Convention, Cancellation, etc.)
- **When deploying:** Follow DEPLOYMENT.md (ECS) or choose an alternative (Lambda, Cloud Run, etc.)
- **When adding a feature:** Ensure it aligns with Stack, Decisions, Security rules, and Coding Standards

---

## Quick Links

- **Repository:** https://github.com/Pravallika117/online_bookstore.git (branch: `pg-db`)
- **Local workspace:** `c:\Users\PravallikaP\Documents\FDE capstone\online_bookstore`
- **Deployment guide:** `DEPLOYMENT.md` (15 AWS steps)
- **Architecture diagram:** `architecture.svg`
- **All tests:** `bun test` (54/54 passing)
- **Type-check:** `bunx tsc --noEmit` (0 errors)
- **Dev server:** `bun dev` (http://localhost:3000)

---

## Contact / Questions

Refer to this context file first. If ambiguous, check the relevant steering file in `.kiro/steering/` or dig into the source code:
- Backend logic: `src/api/*.ts`
- Database: `src/db/schema.ts`, `seed.ts`
- Frontend: `src/frontend/App.tsx`, `lib/api.ts`, `context/`
- Auth: `src/lib/auth.ts`

This document will be updated as the project evolves.
