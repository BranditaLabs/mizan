# ADR-0012: Kysely for database access

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

The schema is plain SQL migrations (`packages/db/migrations`) with row-level security on every tenant table. Each request must run inside a transaction that sets `app.tenant_id` and the `mizan_app` role, so the data layer has to give us full control over transactions and raw SQL. We need typed queries across ~60 tables, PostgreSQL in production, and PGlite for tests and zero-setup local development. Candidates: Kysely and Drizzle.

## Decision

Use **Kysely** (typed SQL query builder), with:

- SQL files remain the source of truth for the schema. A small codegen (`npm run codegen -w @mizan/db`) introspects the migrated schema and writes `packages/db/src/schema.ts`; a test fails when it is stale.
- `withTenant(tenantId, fn)` runs `fn` in a transaction after `SET LOCAL ROLE mizan_app` and `set_config('app.tenant_id', …, true)`.
- Our own migration runner (`packages/db/src/migrate.ts`): ordered files, one transaction each, checksums, advisory lock.
- PostgreSQL via `pg`; PGlite via a ~50-line dialect in `packages/db/src/pglite-dialect.ts`.
- `BIGINT` is parsed to JS `bigint` in both drivers, matching `@mizan/shared` money helpers.

## Consequences

- No ORM layer between us and RLS; every query is visible SQL. Kysely has no runtime schema, so nothing duplicates the migrations.
- Drizzle's schema-in-TypeScript and its migration generator are not used; migrations stay hand-written SQL, reviewed like code.
- Codegen must be re-run after each migration (enforced by test).
