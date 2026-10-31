# AGENTS.md — Mizan

Instructions for any coding agent (Codex, Cursor, Copilot, Claude Code, …) working in this repository.
`CLAUDE.md` is the full version and wins where the two differ; this file carries what you must not miss.

## What Mizan is

Mizan (ميزان, "the scale") is the commerce operating system for MENA brands, powered by Brandita.

- **One product, every channel:** orders from stores, marketplaces and POS.
- **Every payment method:** COD, cards, wallets, deposits, BNPL and bank transfer.
- **Operations:** confirmation, shipping, warehouse, returns, reconciliation, profit and reports.
- **Structure:** 22 modules (M1–M22) connected by events and Automation Studio.
- **Markets:** Egypt first, then KSA and the GCC.

Never write code that assumes an order is COD.

## Where things are

```
packages/shared/        canonical types, zod schemas, exact money, phone normalization
packages/engine/        connectors (Shopify, Bosta, WhatsApp), payments, outbox, resilience, chaos suite
packages/db/            SQL migrations with RLS, migration runner, generated Kysely types
packages/design-system/ tokens, fonts, icons, logo (source of truth for UI)
apps/api/               NestJS modular monolith (one module per M-number)
apps/web/               Next.js App Router dashboard, next-intl AR (default) / EN, RTL
apps/admin/             back office for Mizan staff (same stack as apps/web, /v1/platform only)
docs/                   product, architecture, data model, API, integrations, backlog, ADRs
```

**Which doc to read:**

| For | Read |
| --- | --- |
| What to build next | `docs/10-backlog.md` |
| One module | `docs/modules/Mxx-*.md` |
| Tables, money and profit rules | `docs/04-data-model.md` |
| Endpoints | `docs/05-api.md` |
| Providers | `docs/06-integrations.md` |
| Payments | `docs/12-payments.md` |
| Events and automations | `docs/13-automation-platform.md` |
| Why a choice was made | `docs/adr/` |

## Commands

Requirements: Node 22+, TypeScript strict, tests in vitest.

```
npm install                                   # once, at the root (npm workspaces)
npm run typecheck && npm run lint && npm test # what CI runs (plus build and gitleaks)
npm run build                                 # shared → db → engine → api → web
npm test -w @mizan/engine                     # one package
npm run codegen -w @mizan/db                  # after adding a migration
npm run openapi -w @mizan/api && npm run gen:api -w @mizan/web   # after changing an API route or schema
npm run build:api && npm run build:e2e -w @mizan/web && npm run e2e -w @mizan/web   # browser e2e
```

**Postgres-backed tests** need `TEST_DATABASE_URL` and are skipped without it. Everything else runs on in-memory PGlite.

## Non-negotiable rules

1. **Canonical model only.**
   - Business code never touches provider payloads; connectors map to `@mizan/shared` types.
   - External fields are read through `Resolver` with ranked paths. A missing required field is `schema_drift`.
2. **Every outbound write is an outbox job** with an idempotency key.
   - Request handlers never call providers directly.
   - Webhooks go: verify → dedupe → enqueue → 200.
3. **All provider HTTP goes through `send()`**, with a circuit breaker and a rate bucket. Errors map to `ErrorKind`.
4. **Writes are safe to repeat.**
   - Look up before creating.
   - A non-idempotent request that times out is verified, never re-sent blindly.
5. **Never guess a terminal status.** An unknown courier status becomes `unknown` plus a drift event and a review flag.
6. **Money:**
   - Canonical model: decimal strings (`"1150.00"`).
   - Database: integer minor units plus a currency code.
   - Never floats. FX rates are stored per day.
7. **Tenancy:** every table has `tenant_id` and RLS. Every query runs inside the tenant context.
8. **Secrets** are encrypted at rest and read through the secrets service. Never commit them, never log them, never paste them into chat.
9. **Arabic and English are equal.**
   - Every UI string goes through i18n, in Egyptian Arabic for merchant copy.
   - Use logical CSS (`ms-*`, `inline-size`), never left/right.
   - Numbers, phones and order IDs go in `<bdi>`. Use Western digits.
10. **Personal data:** phones and addresses fall under Egypt Law 151/2020 and KSA PDPL.
    - Minimize, encrypt and audit reveals.
    - No PII in logs or sent to AI.
11. **Payments are first class.**
    - Courier cash comes only from `cashToCollect(order)`.
    - Unknown or unpaid methods never ship. Card data never enters Mizan.
    - Every money movement is a line in the `payments` ledger.
12. **Modules talk through events.**
    - No direct cross-module calls for reactions.
    - New events go in `packages/shared/src/events.ts` and `docs/13`.
13. **Tests first for integration logic.** Each connector gets a fake server with real quirks and must pass the chaos suite.

## Definition of done

- [ ] Typecheck, lint and tests pass. The chaos suite is still green if engine code changed.
- [ ] AR and EN strings are both present, and RTL is checked for UI.
- [ ] No secrets and no PII in logs.
- [ ] A schema change ships as a new migration plus a test in `packages/db`.
- [ ] An API change has zod schemas on the route, a regenerated `openapi.json` and regenerated web types.
- [ ] Docs are updated (`docs/04`, `docs/05`, the module doc) and the item is ticked in `docs/10-backlog.md`.

## How to work

- Pick the next unchecked item in the current phase of `docs/10-backlog.md`.
- Make one small, PR-sized change per story, with tests.
- Ask before changing an ADR decision; record a new ADR if you do.
- Don't hard-code unconfirmed provider facts (Bosta state codes, gateway formats). See "Facts to confirm" in `CLAUDE.md`.
