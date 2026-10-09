# BooksOnline — Test Report

Run against local PostgreSQL (localhost:5432, db `booksonline`, user `postgres`).
DATABASE_URL unset → used documented default `postgres://postgres:password@localhost:5432/booksonline`.

Environment: Windows / PowerShell, Bun 1.4.2.

## Commands run

1. `bun install`
2. `bunx tsc --noEmit`
3. `bun test`

## Results

| Step | Command | Result |
|------|---------|--------|
| Install | `bun install` | PASS — 112 installs checked, no changes, nothing Node-based added |
| Typecheck | `bunx tsc --noEmit` | PASS — exit 0, no type errors |
| Tests | `bun test` | PASS — 54 pass / 0 fail (128 `expect()` calls, 5 files, ~2.3s) |

Per-file: `auth.test.ts` 12, `books.test.ts` 13, `commerce.test.ts` 24, `recommendations.test.ts` 3, `db.test.ts` 5.

## Failures

None. Everything passes.

Note: `bun test` writes its banner to stderr; under PowerShell this surfaces a cosmetic
`NativeCommandError` line, but the process exit code is 0 and all tests pass.
