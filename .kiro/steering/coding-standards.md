---
Inclusion: always
---

# Coding Standards

## TypeScript
- Strict mode is required (`"strict": true` in tsconfig). All new code must compile with `bunx tsc --noEmit` clean.
- Exported functions and methods must have explicit return types.
- Avoid `any`; when unavoidable, add an inline comment explaining why.
- Prefer `interface` over `type` for object shapes.
- Never use non-null assertion (`!`) without a comment explaining why it is safe.

## Naming Conventions
- Variables and functions: `camelCase`.
- React components, classes, interfaces: `PascalCase`.
- Constants (module-level, never reassigned): `SCREAMING_SNAKE_CASE`.
- File names: `kebab-case` (e.g. `book-card.tsx`, `auth.ts`).

## Imports
- Frontend code: use the `@/*` alias for absolute imports (configured in tsconfig and bunfig.toml).
- Backend code: use relative imports.
- Import order: external packages first, then internal modules, then type-only imports (`import type`).
- Avoid barrel re-exports that hide tree-shaking (no `export * from` aggregators unless intentional).

## Formatting
- 2-space indentation.
- Single quotes for strings.
- Trailing commas in multi-line arrays/objects/params.
- 100-character line limit.
- No trailing whitespace.

## Comments and Documentation
- JSDoc (`/** ... */`) on every exported function, class, and interface.
- Inline comments for non-obvious logic (why, not what).
- No commented-out code in committed files.

## React
- Functional components only — no class components.
- Props interfaces named `<Component>Props` (e.g. `BookCardProps`).
- Custom hooks live in `src/frontend/hooks/`.
- No inline styles; use Tailwind utility classes exclusively.
- Every interactive element (button, link, form) must have a real handler — no `onClick={() => {}}` stubs.

## Error Handling
- Never swallow errors silently. Always propagate or log.
- API route handlers must wrap async logic in try/catch and return `{ error: string }` with the appropriate HTTP status.
- The consistent error envelope is `{ error: string }` for failure, with the body containing the resource on success.

## Testing
- Test files are co-located: `*.test.ts` next to the file under test.
- Descriptive test names in plain English.
- Each test (or describe block) must clean up DB state: `TRUNCATE ... RESTART IDENTITY CASCADE`.
- Tests must not rely on state from prior tests; each test is independently runnable.
- Test runner: `bun test` (bun:test, not jest).
