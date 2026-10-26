# CLAUDE.md — Mizan

Instructions for Claude Code working in this repository. Read this first, then the doc for the area you are touching.

## What Mizan is

Mizan (ميزان, "the scale") is the **complete commerce operating system** for MENA brands, powered by Brandita. One product runs orders from every channel (stores, marketplaces, POS), payments by **every method** (cash on delivery, cards, wallets, deposits, BNPL, bank transfer), verification, shipping, warehouse, purchasing, returns, customer service, reconciliation, finance and reports — connected by an event bus and **Automation Studio**, with a **profit engine that shows real profit per order**. 22 modules (M1–M22). Launch market is Egypt, then KSA and the GCC. COD is a strength, not the boundary: never write code that assumes an order is COD.

## Doc map

| Need | Read |
| --- | --- |
| Why, for whom, pricing, unit economics | `docs/01-business-model.md` |
| Scope, domains, 22 modules, lifecycles, NFRs, roles | `docs/02-product.md` |
| One module in depth | `docs/modules/Mxx-*.md` |
| Payment methods, ledger, cash rule, refunds, fees | `docs/12-payments.md` |
| Events, actions, recipes, automation guarantees | `docs/13-automation-platform.md` |
| Deployables, module layout, events, tenancy | `docs/03-architecture.md` |
| Tables, money, profit rules | `docs/04-data-model.md` + `packages/db/migrations/` |
| Endpoint conventions and list | `docs/05-api.md` |
| Provider access, quirks, what to apply for | `docs/06-integrations.md` |
| Security, PII, Shopify GDPR webhooks, laws | `docs/07-security-compliance.md` |
| Tokens, RTL, components, logo, icons | `packages/design-system` (source of truth; `reference/index.html`, `docs/components.md`) + `docs/08-design-system.md`; `design/prototype.html` for layouts only |
| Environments, CI/CD, monitoring, runbooks | `docs/09-infrastructure.md` |
| **What to build next** | `docs/10-backlog.md` |
| Terms (EN/AR) | `docs/11-glossary.md` |
| Why a technical choice was made | `docs/adr/` |

## Repository map

```
packages/engine/   ✅ BUILT — integration engine: Shopify + Bosta + WhatsApp Cloud connectors, every payment method (cashToCollect), outbox, resilience, adaptation (85 tests)
packages/db/       ✅ BUILT — SQL migrations with RLS, migration runner (`mizan-db migrate`), generated Kysely types, withTenant (22 tests incl. real Postgres)
packages/design-system/ ✅ BUILT — Brandita identity (ink, paper, one red point): tokens for CSS/Tailwind/TS/Flutter, Geist + Alexandria + Plex Arabic fonts, 124 icons, wordmark, app icons (70 tests: contrast, brand fidelity)
packages/shared/   ✅ BUILT — canonical types, zod schemas, exact money (toMinor/fromMinor), EG/KSA/UAE phone normalization (122 tests)
apps/api/          🚧 FOUNDATIONS (E1) — NestJS 12: config, redacting logger, problem+json, OpenAPI, tenant DB, Firebase auth + roles, signup, team, domain events + worker, audit log, KMS secrets; modules M1–M22 next
apps/web/          🚧 FOUNDATION (E4-1…E4-3) — Next.js 16 + Tailwind 4 dashboard on @mizan/design-system, next-intl AR (default) / EN with RTL, light/dark/system theme, lint rules; Firebase sign-in (email + SMS second step, phone OTP), store gate and switcher; UI kit in src/components/ui (gallery at /ar/ui, /en/ui); typed API client + TanStack Query (src/lib/api); onboarding wizard (E4-5); orders list and detail with audited reveal (E5-1, E5-2); Settings → Costs with daily FX (E9-1); automated confirmation (E6-7) inside the WhatsApp chat with the team's "Needs a call" list and Settings → Confirmation (E6-10); profit per order on the order screen (E9-2); profit home (E9-4) and breakdown (E9-5); products with costs, barcodes and CSV import (E8-1); stock with reservations, oversell block, low-stock alerts and the store's count (E8-2, E8-5); ops-app sync API (E8-3); automations with recipes, run log and the notification bell (E11)
apps/ops/          ⏳ planned — Flutter app for warehouse, agents, receiving and later POS (offline-first)
design/            prototype.html — the approved UI direction (open it in a browser)
docs/              everything below
.claude/commands/  slash commands for recurring work
.github/workflows/ ci.yml — typecheck + tests + gitleaks on every PR (renovate.json for deps)
```

## Commands

```
npm install                 # once, at the repo root (npm workspaces)
npm test                    # all packages
npm run typecheck
npm run build                # shared → dist, api → dist (CI runs it before tests)
npm run dev -w @mizan/api    # API on :8080 with reload (cp apps/api/.env.example apps/api/.env first); in-memory PGlite DB
npm run codegen -w @mizan/db # after adding a migration: regenerate packages/db/src/schema.ts
npm run openapi -w @mizan/api && npm run gen:api -w @mizan/web  # after changing an API route or schema: openapi.json + web client types
npm run demo                # engine demo against misbehaving fake Shopify and Bosta
npm run dev -w @mizan/web    # dashboard on :3000 (/ar, /en); sign-in needs Firebase config or the emulator (apps/web/.env.example)
npm run build:api && npm run build:e2e -w @mizan/web && npm run e2e -w @mizan/web   # e2e: Auth emulator (Java 21) + API + web
npm test -w @mizan/design-system  # tokens: WCAG contrast both themes, brand fidelity, generated files current (build after editing tokens.json)
npm run lint                # ESLint (web: no physical directions, no literal UI strings)
npm run load -w @mizan/perf # load test vs real API on Postgres (needs npm run build + TEST_DATABASE_URL); see docs/perf
docker compose up --build   # prod-like stack: Postgres 16, migrations, API :8080, worker :8081 (deploy/compose/smoke.sh checks it)
npm test -w @mizan/engine   # one package (or -w @mizan/db, -w @mizan/shared)
```

Node 22+. TypeScript strict everywhere. Tests use vitest.

## Stack (decided — see docs/adr/)

| Layer | Choice |
| --- | --- |
| Language | TypeScript (strict) for backend and web; Dart for the ops app |
| API | NestJS modular monolith, one deployable, modules map to M1–M22 |
| Web | Next.js (App Router) + Tailwind CSS; RTL first-class; next-intl for AR/EN |
| Mobile ops app | Flutter, offline-first (local queue, sync on reconnect) |
| Database | PostgreSQL with row-level security per tenant |
| Jobs | Postgres outbox (`packages/engine/src/sync`), `FOR UPDATE SKIP LOCKED`; no Redis needed for MVP |
| Auth | Firebase Authentication (email + phone OTP) for users; API verifies Firebase ID tokens |
| Push | Firebase Cloud Messaging |
| Analytics store | PostgreSQL materialized views first; ClickHouse/BigQuery only when needed |
| Hosting | Google Cloud, Middle East region (Doha `me-central1` or Dammam `me-central2`) |

Pin exact versions in `package.json` when creating each app.

> The v1.0 product spec PDF mentions Redis/BullMQ; that is superseded by ADR-0002 (Postgres outbox). Use the latest stable release at that time.

## Non-negotiable rules

1. **Canonical model only.** Business code never touches provider payloads. Connectors map Shopify/Bosta/etc. to the canonical types (`packages/shared/src/model.ts`, imported as `@mizan/shared`) and back.
2. **Never read external fields directly.** Use `Resolver` with ranked candidate paths (`packages/engine/src/adapt/resolve.ts`). Required fields fail with a `schema_drift` error naming the paths tried.
3. **Every outbound write is an outbox job** with an idempotency key. No direct calls to providers from request handlers. Webhook handlers verify → dedupe → enqueue → return 200 fast.
4. **All provider HTTP goes through `send()`** (`packages/engine/src/resilience/http.ts`) with a circuit breaker and a rate-limit bucket per connection. Classify errors into the `ErrorKind` taxonomy; never throw raw HTTP errors.
5. **Writes must be safe to repeat.** Use the provider's idempotency key where it exists; otherwise look up before creating (see Bosta `createShipmentOnce`). A non-idempotent request that times out is verified, never blindly re-sent.
6. **Thin webhook, fat fetch.** Treat webhooks as hints; re-read the resource from the API before acting.
7. **Never guess a terminal status.** Unknown courier statuses become `unknown` + drift event + review flag. Terminal statuses (delivered, returned, cancelled, lost) need label confirmation or ops override.
8. **Money:** decimal strings in the canonical model (`"1150.00"`), integer minor units + currency code in the database. Never floats for money. FX rate stored per day.
9. **Multi-tenancy:** every table has `tenant_id`; every query runs under the tenant's RLS context. No cross-tenant reads except the risk-network service (hashed data only).
10. **Secrets** (provider tokens, API keys) are encrypted at rest and read through a secrets service. Never commit them, never log them.
11. **Arabic and English are equal.** All user-facing strings go through i18n; layouts use logical CSS properties (`margin-inline-start`, not `margin-left`); numbers, phones and order IDs are wrapped in `<bdi>` inside Arabic text. Egyptian Arabic for merchant UI copy.
12. **Personal data:** customer phones/addresses are personal data under Egypt Law 151/2020 and KSA PDPL. Minimize, encrypt, log access, honour deletion requests (Shopify `customers/redact`, `shop/redact`).
13. **Payments are first class.** Every order carries `payment_mode` and `payment_status`. Courier cash comes only from `cashToCollect(order)` (`packages/engine/src/core/payments.ts`), never from the order total. Unknown or unpaid methods never ship. Card data never enters Mizan (hosted pages and links only). Every money movement is a line in the `payments` ledger. See `docs/12-payments.md` and ADR-0011.
14. **Every module talks through events.** New behaviour that reacts to another module is an automation or an event handler, never a direct cross-module call. Register new triggers and actions in the catalogue (`docs/13-automation-platform.md`).
15. **Tests first for integration logic.** Every connector gets a fake server with the provider's real quirks and failure modes, and must pass the chaos suite (`packages/engine/test/e2e.chaos.test.ts` pattern).

## Definition of done (any task)

- Code typechecks; tests added and passing; chaos suite still green when engine code changed.
- Arabic and English strings present; RTL checked for UI.
- No secrets, no PII in logs.
- Docs updated when behaviour, schema or API changed (`docs/04`, `docs/05`, module doc). Schema changes = new migration + test in `packages/db`. API changes = zod schemas on the route (`@ApiJson…`), regenerated `openapi.json` and web types.
- Backlog item ticked in `docs/10-backlog.md`.

## Facts to confirm before production (do not hard-code assumptions)

- Bosta numeric state codes, `deliveries/search` body, `dropOffAddress` city field, public tracking URL — confirm with Bosta's API reference in the business account; the engine is built to tolerate all variants until then.
- Shopify: pinned API version `2026-10`; review quarterly. Protected customer data Level 2 must be approved for order PII.
- WhatsApp: Embedded Signup v4 (v2 deprecated 15 Oct 2026). Per-message pricing since 1 Jul 2025.
- Each gateway, BNPL and marketplace: authentication, webhook signing, refunds and payout report formats — confirm from the provider's docs before building (`docs/06-integrations.md`).
- All prices in `docs/01-business-model.md` are proposals to validate with pilot merchants.

## How to work here

- Start each session by reading `docs/10-backlog.md` and picking the next unchecked item in the current phase.
- Use the slash commands in `.claude/commands/` for recurring work: `/new-connector`, `/new-module`, `/chaos-check`, `/i18n-check`.
- Prefer small PR-sized changes with tests. Ask before changing an ADR decision; record a new ADR if you do.
