# ADR 0004: API foundation: auth, audit and validation

- Status: Accepted
- Date: 2026-10-29

## Context

BUILD_PROMPTS 2.1 asks for zod validation, one error shape, request-id logging, OpenAPI at `/docs`, owner login (argon2, JWT access + refresh, global guard, roles in the schema), an audit interceptor with before/after, settings with `effective_from`, and integration tests on a real Postgres. CLAUDE.md adds: every change or void writes `audit_log`, no hard delete, append-only tables, a `server_seq` for sync.

## Decision

**Validation (the "nestjs-zod or equivalent").** nestjs-zod 5.5 supports Nest ≤ 11 only. `src/common/zod.ts` is the equivalent:

- `ZodBody` / `ZodQuery` / `ZodParam` validate request input with the `@fabric/contracts` schemas and document it in OpenAPI.
- `ZodResponse` documents the output and parses it on the way out, so unknown fields (a password hash) are never sent.
- Lint forbids the bare `@Body` / `@Query` / `@Param` in modules.
- Validation does not depend on decorator metadata, so it behaves the same under tsc and in tests.
- The contracts take the place of `dto/` folders; a module adds one only for shapes that are not in the contracts.

**Errors.** One shape, `{ error: { code, message, requestId, issues? } }` (`errorResponseSchema`). Codes are machine-readable; the web client shows its own i18n text per code. Unexpected errors answer `internal_error` without their message, and are logged.

**Logging.** pino via nestjs-pino:

- JSON lines, one request id per request: a safe incoming `x-request-id` is kept, otherwise one is generated. It is echoed in the response header and copied into errors and audit entries.
- Authorization, cookies and set-cookie headers are redacted; bodies are never logged.

**Auth.**

- **Passwords:** argon2id with OWASP's minimum parameters (19 MiB, t=2, p=1). Unknown usernames are verified against a dummy hash, so they take as long as a wrong password.
- **Access token:** a 15-minute HS256 JWT returned in the body. The web client keeps it in memory.
- **Refresh token:** 256 random bits, stored only as a sha256 hash. It travels in an `httpOnly`, `Secure`, `SameSite=Strict` cookie scoped to `/api/auth`. Each refresh rotates it within its family. Presenting a rotated or revoked token revokes the whole family and is audited (OWASP refresh-token reuse detection).
- **Reuse grace:** a rotated token presented again within 30 seconds is rotated again, and the successor it never received is revoked. A page load can abort a refresh after the server has rotated the token (found by the Playwright tests), and without this the owner would be signed out everywhere. Later reuse, or reuse of a revoked token, still revokes the whole family (Auth0's "reuse interval").
- **Rate limit:** login is limited to `AUTH_LOGIN_RATE_LIMIT` attempts a minute per client IP (default 5), refresh to 30. Caddy is a trusted proxy hop, so the limit sees the real client IP.
- **Global guard:** every route is protected unless marked `@Public()`. The schema has the `owner`, `partner` and `cashier` roles; only `owner` is admitted for now, at login and on every request.
- **Owner account:** created, or its password reset, only by `make owner` (password on stdin). There is no HTTP setup route, so nobody can claim the account on a fresh server.

**Unit of work and audit.**

- Every mutating request (POST/PUT/PATCH/DELETE) runs in one database transaction, opened by the global `AuditInterceptor`. Repositories use the current transaction through `TransactionHost` (AsyncLocalStorage).
- The transaction commits only if the handler wrote at least one audit entry. Otherwise it rolls back and answers 500, so an unaudited change cannot slip in.
- Actor, device (`x-device-id`) and reason (`x-audit-reason`, percent-encoded UTF-8) come from the request.
- `@AuditExempt(why)` is for routes that change nothing auditable or that need their own transactions, such as token refresh, whose revocation must survive the failed request.

**Database guards** (migration `0001_row_guards`), installed on every table by `install_row_guards(table, append_only)`:

- Any `DELETE` or `TRUNCATE` statement is refused, even one that matches no row.
- Append-only tables refuse `UPDATE`.
- Every insert and update takes the next value of one global `server_seq`, so sync has a single cursor (ADR 0002).
- An integration test fails for any table without its guards or base columns.

**Migrations.** The single API instance applies pending migrations on start (`MIGRATE_ON_START`, set by both compose files); `make migrate` does the same by hand. CI fails if the schema changed without a migration.

**Settings.** One row per key and `effective_from` (null = since always). The value in effect on a day is the latest row on or before it, else the default from `@fabric/contracts` `SETTINGS`. Values are validated per key; every write is audited with before/after.

**Integration tests.** Testcontainers starts one `postgres:16.15-alpine` per run and migrates a template database once. Each test file gets its own copy (`CREATE DATABASE … TEMPLATE`) and the full app, with the same modules, guards, filters and HTTP setup as `main.ts`.

## Consequences

- Login and refresh need cookies on the same site as the web app. In production Caddy serves both under one domain. In development the web app proxies `/api` to the API (BUILD_PROMPTS 3.1).
- An access token stays valid for up to 15 minutes after logout; refresh tokens are revoked at once.
- Two tabs refreshing with the same token at the same moment look like reuse and sign the user out. The web client must refresh through a single lock (Web Locks API) in BUILD_PROMPTS 3.1.
- Integration tests need Docker, locally and in CI.
- A new table must call `install_row_guards` in its migration; the test above enforces it.

## Sources

- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) (argon2id parameters)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) (cookie attributes)
- [OAuth 2.0 Security Best Current Practice, RFC 9700 §4.14](https://www.rfc-editor.org/rfc/rfc9700#section-4.14) (refresh-token rotation and reuse detection)
- [NestJS testing with Vitest and SWC](https://docs.nestjs.com/recipes/swc#vitest)
