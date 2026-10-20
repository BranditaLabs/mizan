# CLAUDE.md — Mizan

Instructions for Claude Code working in this repository. Read this first, then the doc for the area you are touching.

## What Mizan is

Mizan (ميزان, "the scale") is a MENA e-commerce operating system, powered by Brandita. It runs the work between checkout and cash for online stores that sell cash on delivery (COD): order intake, confirmation, shipping, warehouse, returns, cash reconciliation, and a **profit engine that shows real profit per order**. Launch market is Egypt, then KSA and the GCC.

## Doc map

| Need | Read |
| --- | --- |
| Why, for whom, pricing, unit economics | `docs/01-business-model.md` |
| Scope, lifecycle, statuses, NFRs, roles | `docs/02-product.md` |
| One module in depth | `docs/modules/Mxx-*.md` |
| Deployables, module layout, events, tenancy | `docs/03-architecture.md` |
| Tables, money, profit rules | `docs/04-data-model.md` + `packages/db/migrations/` |
| Endpoint conventions and list | `docs/05-api.md` |
| Provider access, quirks, what to apply for | `docs/06-integrations.md` |
| Security, PII, Shopify GDPR webhooks, laws | `docs/07-security-compliance.md` |
| Tokens, RTL, components | `docs/08-design-system.md` + `design/prototype.html` |
| Environments, CI/CD, monitoring, runbooks | `docs/09-infrastructure.md` |
| **What to build next** | `docs/10-backlog.md` |
| Terms (EN/AR) | `docs/11-glossary.md` |
| Why a technical choice was made | `docs/adr/` |

## Repository map

```
packages/engine/   ✅ BUILT — integration engine: Shopify + Bosta connectors, outbox, resilience, adaptation (57 tests)
packages/db/       ✅ BUILT — PostgreSQL schema (migrations/0001_core.sql) with RLS; tests prove tenant isolation (5 tests)
packages/shared/   ⏳ planned — canonical types, zod schemas, money + phone helpers (backlog E1-2)
apps/api/          ⏳ planned — NestJS modular monolith (REST API, auth, tenants, modules M1–M14)
apps/web/          ⏳ planned — Next.js dashboard, Arabic + English, RTL; visual reference: design/prototype.html
apps/ops/          ⏳ planned — Flutter app for warehouse staff and confirmation agents (offline-first)
design/            prototype.html — the approved UI direction (open it in a browser)
docs/              everything below
.claude/commands/  slash commands for recurring work
```

## Commands

```
npm install                 # once, at the repo root (npm workspaces)
npm test                    # all packages
npm run typecheck
npm run demo                # engine demo against misbehaving fake Shopify and Bosta
npm test -w @mizan/engine   # one package (or -w @mizan/db)
```

Node 22+. TypeScript strict everywhere. Tests use vitest.

## Stack (decided — see docs/adr/)

| Layer | Choice |
| --- | --- |
| Language | TypeScript (strict) for backend and web; Dart for the ops app |
| API | NestJS modular monolith, one deployable, modules map to M1–M14 |
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

1. **Canonical model only.** Business code never touches provider payloads. Connectors map Shopify/Bosta/etc. to the canonical types (`packages/engine/src/core/model.ts`, moving to `packages/shared`) and back.
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
13. **Tests first for integration logic.** Every connector gets a fake server with the provider's real quirks and failure modes, and must pass the chaos suite (`packages/engine/test/e2e.chaos.test.ts` pattern).

## Definition of done (any task)

- Code typechecks; tests added and passing; chaos suite still green when engine code changed.
- Arabic and English strings present; RTL checked for UI.
- No secrets, no PII in logs.
- Docs updated when behaviour, schema or API changed (`docs/04`, `docs/05`, module doc). Schema changes = new migration + test in `packages/db`.
- Backlog item ticked in `docs/10-backlog.md`.

## Facts to confirm before production (do not hard-code assumptions)

- Bosta numeric state codes, `deliveries/search` body, `dropOffAddress` city field, public tracking URL — confirm with Bosta's API reference in the business account; the engine is built to tolerate all variants until then.
- Shopify: pinned API version `2026-10`; review quarterly. Protected customer data Level 2 must be approved for order PII.
- WhatsApp: Embedded Signup v4 (v2 deprecated 15 Oct 2026). Per-message pricing since 1 Jul 2025.
- All prices in `docs/01-business-model.md` are proposals to validate with pilot merchants.

## How to work here

- Start each session by reading `docs/10-backlog.md` and picking the next unchecked item in the current phase.
- Use the slash commands in `.claude/commands/` for recurring work: `/new-connector`, `/new-module`, `/chaos-check`, `/i18n-check`.
- Prefer small PR-sized changes with tests. Ask before changing an ADR decision; record a new ADR if you do.
