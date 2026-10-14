---
Inclusion: always
---

# Security

## Authentication
- JWT is stored client-side (localStorage or in-memory). Sent as `Authorization: Bearer <token>`.
- The server **always** re-loads the user record from the database inside `authGuard` — never trusts a `userId` or role claim from the token payload directly without DB confirmation.
- Token TTL: 7 days (`TOKEN_TTL_SECONDS = 604800`).
- A startup warning (`console.warn`) must fire when `JWT_SECRET` is the insecure dev fallback **and** `NODE_ENV` is not `'development'`.

## Authorisation
- Every authenticated route that reads or mutates a resource checks ownership: `AND user_id = ${userId}` in the query.
- A foreign resource ID (one that belongs to another user) resolves to **404**, not 403 — avoid leaking existence of other users' resources.

## Password Security
- Passwords are hashed with `Bun.password` (argon2id algorithm).
- `password_hash` is **never** included in any API response.
- All user-returning queries must either use an explicit column list that omits `password_hash`, or pass the result through `toPublicUser()` before serialisation.

## SQL Injection Prevention
- All queries use Bun.sql tagged templates or `database(array)` for `IN` clauses.
- User-supplied values are **never** string-interpolated into SQL.
- `ORDER BY` column names are chosen from a fixed allowlist (e.g. `SORT_KEYS` in books.ts) — never taken directly from query params.

## Input Validation
- Every POST/PATCH route has an `Elysia t.Object()` schema on the request body.
- Email format, password minimum length (8 chars), and required fields are enforced at the schema level.
- Query params (sort, category, page, etc.) are validated and defaulted before use.

## Sensitive Environment Variables
- `JWT_SECRET` must be set to a strong random secret in production. The dev fallback (`'dev-only-insecure-secret-change-me'`) is documented as insecure.
- `DATABASE_URL` carries credentials — never log it, never include it in error responses.
- Document required env vars in README and `.env.example`.

## HTTP Security Headers
- `Bun.serve` does not add security headers by default.
- In production, a reverse proxy (nginx, ALB, Caddy) must add:
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains`
  - `Content-Security-Policy` appropriate for the SPA.

## Atomic Transactions
- Checkout, cancel, and buy-again operations use `database.begin()` to prevent partial state.
- Any `CheckoutError` (or equivalent domain error) thrown inside a transaction triggers a full rollback.

## Rate Limiting
- ⚠️ **Known gap:** `/api/auth/login` and `/api/auth/register` do not currently have rate limiting. Add an IP-based rate limiter (e.g. a sliding-window middleware) before production deployment.

## Business-Logic Security
- The 48-hour cancellation window is enforced server-side using the stored `cancellable_until` timestamp — the client never supplies this value.
- Gift-point redemption is clamped server-side: `Math.min(pointsToRedeem, availablePoints)`. The client value is never trusted.
- Payment is fully mocked (`status: 'paid'`, `method: 'MOCK'`). No real gateway credentials are stored.
