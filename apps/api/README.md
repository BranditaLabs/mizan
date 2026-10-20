# @mizan/api — Mizan API

NestJS 12 (ESM) modular monolith: REST API (`src/main.ts`) and worker (`src/worker.ts`) from one image (ADR-0003).

```
cp .env.example .env          # once
npm run dev -w @mizan/api     # http://localhost:8080/health · /v1/openapi.json
npm test -w @mizan/api
npm run build -w @mizan/api && node apps/api/dist/main.js
```

## Layout (docs/03 §3)

| Path | What |
| --- | --- |
| `src/main.ts` | Validates env (`loadConfig`) before importing Nest; bad env → stderr list + exit 1 |
| `src/bootstrap.ts` | `createApp(config, options)`: `/v1` prefix (except `/health`), logger, OpenAPI; used by main and tests |
| `src/platform/config.ts` | Zod schema for every env variable; `APP_CONFIG` injection token |
| `src/platform/logging/` | pino via `nestjs-pino`; `X-Request-Id`; PII redaction by key (`phone`, `name`, `address*`, tokens…) and by content (phones in EG/SA/AE formats incl. Arabic digits, emails, bearer tokens, provider keys) |
| `src/platform/http/` | `ProblemError`, global `ProblemFilter` (RFC 9457, AR/EN titles), `ZodPipe` for DTOs from `@mizan/shared` |
| `src/platform/i18n/` | Server-side AR/EN messages, `Accept-Language` negotiation (Arabic default) |
| `src/platform/db/` | `Database` (inject it): `tenant(id, fn)` under RLS, `platform(fn)`, `ping()`. Postgres pool in prod; in-memory PGlite (migrated at boot) when `DATABASE_URL` is unset |
| `src/platform/auth/` | `AuthGuard` (global): Firebase ID token → user (created on first sign-in) → `X-Tenant-Id` active membership → MFA for owner/admin → `@Roles`. Decorators: `@Public()`, `@NoTenant()`, `@Roles(...)`, `@Auth()` |
| `src/platform/openapi.ts` | OpenAPI 3.1 from decorators + zod component schemas, served at `/v1/openapi.json` |
| `src/modules/` | Product modules (M1–M22). Today: `health` (`/health`, `/health/ready`), `users` (`GET /v1/me`) |

## Rules

- Routes are protected by default. Mark webhooks and probes `@Public()`; routes without a store `@NoTenant()`; restrict with `@Roles(...)`. Read the caller with `@Auth()`.
- Tenant data: `db.tenant(auth.tenant.id, trx => …)`; never filter by `tenant_id` by hand as the only guard.

- Throw `ProblemError(status, code, detail)` for expected failures; `detail` must not contain personal data.
- Validate input with `ZodPipe(schema)`; reuse schemas from `@mizan/shared`.
- Log objects, not concatenated strings; redaction covers both, but objects keep fields searchable.
- Tests run on vitest + SWC (decorator metadata); `test/app.e2e.test.ts` shows how to mount a module and capture logs.
