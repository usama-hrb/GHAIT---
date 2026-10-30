# ADR 0001: Technology stack

- Status: Accepted
- Date: 2026-10-29
- Decided by: project owner (fixed in [BUILD_PROMPTS.md](../BUILD_PROMPTS.md))

## Context

SPEC §12 requires a local-first app that runs on a desktop (main till) and a phone, works without internet, syncs both ways, and keeps accounting exact (integer cents and cm). SPEC §12.2 listed options for discussion: a PWA; React or Svelte; SQLite-WASM or Dexie locally; Supabase/Postgres with PowerSync, ElectricSQL or custom sync. It asked for the simplest option for a single user. The owner then fixed the stack in BUILD_PROMPTS. This ADR records that decision and its trade-offs.

Constraints that drive the choice:

- The same accounting code must run in the browser (offline) and on the server (re-validation).
- One person maintains it at first. Later it may become a SaaS for other fabric shops.
- Data lives on the devices; the server is the sync hub and the backup.

## Decision

| Concern            | Choice                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| Language           | TypeScript, `strict`, everywhere                                                                         |
| Repo               | pnpm workspaces + Turborepo monorepo                                                                     |
| Accounting logic   | `packages/core` (`@fabric/core`): pure functions, no dependencies, Vitest + fast-check                   |
| Shared schemas     | `packages/contracts` (`@fabric/contracts`): zod schemas for API DTOs and sync ops                        |
| API                | NestJS modular monolith (`apps/api`), one module per feature                                             |
| Database           | PostgreSQL 16; money as bigint cents. ORM: Drizzle (ADR 0003)                                            |
| Web                | Next.js App Router (`apps/web`), Tailwind, installable PWA, Arabic RTL                                   |
| Local DB and sync  | Dexie (IndexedDB) with our own outbox + push/pull sync (ADR 0002)                                        |
| Runtime and deploy | Docker images (multi-stage, non-root), compose for dev and prod, reverse proxy with HTTPS on a small VPS |
| Quality gates      | ESLint with boundary rules, dependency-cruiser, typecheck, tests; run by `make check` and CI             |

## Rationale

- One language end to end: `@fabric/core` and `@fabric/contracts` run unchanged in the browser, the API and tests, so each accounting rule exists once.
- Modular monolith: one deployable fits a one-shop workload, and module boundaries stay clean enough to split modules or add tenancy later.
- PostgreSQL: transactional, mature, bigint money, simple `pg_dump` backups, a sound base for a future SaaS.
- Next.js App Router + PWA: one codebase for desktop and phone, installable, offline through a service worker.
- Self-hosted Docker: no vendor lock-in, predictable cost, the same images from dev to prod.
- Own sync instead of a sync product: the data is mostly append-only movements with idempotent ops, so a small push/pull keyed on `server_seq` fits it and keeps the merge rules of SPEC §12.1 in our code.

## Alternatives considered

- **Supabase + PowerSync or ElectricSQL.** Least code for sync and auth; probably the simplest path for a single user, as SPEC §12.2 hinted. It adds a hosted dependency and puts merge behaviour in a third-party engine. Not chosen; the cost of the chosen stack is that we build and maintain sync ourselves.
- **SvelteKit, or a plain React SPA (Vite).** Smaller and arguably simpler for an offline app, since server rendering adds little when domain data lives in IndexedDB. Not chosen.
- **Express/Fastify without NestJS.** Less ceremony, but no module system or DI; Nest modules map directly onto the feature boundaries in BUILD_PROMPTS §1.
- **SQLite via WASM in the browser.** Covered in ADR 0002.

## Consequences

- We own the sync code (outbox, idempotent push, paged pull, conflict log). It is the riskiest part of the system and gets unit, integration and Playwright offline tests (ADR 0002).
- Next.js server rendering is not used for domain data. Domain screens are client components reading `local-db`; the server only serves the app shell and static assets.
- Workspace packages are built with tsup and transpiled by Next (`transpilePackages`).
- More moving parts than a hosted backend (API, DB, proxy, backups), so the Makefile, compose files, runbooks and CI are set up in Phase 0.
- Multi-tenancy is out of scope (SPEC §1). Adding it later means a tenant key on every table and per-tenant sync scopes.
