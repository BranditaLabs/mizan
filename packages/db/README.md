# @mizan/db

PostgreSQL schema and typed access for Mizan (ADR-0012).

| Path | What |
| --- | --- |
| `migrations/NNNN_name.sql` | The schema. Forward-only; never edit an applied file. RLS on every tenant table; `0003` creates the `mizan_app` role |
| `src/migrate.ts` | Runner: ordered, one transaction per file, checksums in `schema_migrations`, advisory lock |
| `src/cli.ts` | `mizan-db migrate` — reads `DATABASE_URL_MIGRATOR` (or `DATABASE_URL`) |
| `src/schema.ts` | **Generated** Kysely types (`npm run codegen -w @mizan/db`) |
| `src/tenant.ts` | `withTenant(db, tenantId, fn)` (RLS-scoped transaction as `mizan_app`), `withoutTenant` |
| `src/clients.ts` | `createPgDb` (node-postgres, BIGINT → bigint), `createPglite` / `createPgliteDb`, migration clients |
| `src/pglite-dialect.ts` | Kysely dialect for PGlite (tests, local dev) |

```
npm test -w @mizan/db                                              # PGlite
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test -w @mizan/db   # + real Postgres
npm run codegen -w @mizan/db                                       # after adding a migration
```

**Adding a migration:** create `migrations/NNNN_name.sql` → `npm run codegen -w @mizan/db` → add a test in `test/` → update `docs/04-data-model.md`. New tenant tables need `tenant_id`, `ENABLE` + `FORCE ROW LEVEL SECURITY` and the `tenant_isolation` policy (see the loop at the end of `0001_core.sql`).
