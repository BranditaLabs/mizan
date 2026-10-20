# 10 — Roadmap and backlog

**How to use this file (Claude Code):** pick the first unchecked story in the current phase whose dependencies are done. Each story is sized to one PR. Tick it (`[x]`) in the same PR that delivers it. Add new stories under the right epic instead of doing unplanned work.

Legend: `S` ≈ ½ day, `M` ≈ 1–2 days, `L` ≈ 3–5 days (split before starting).

---

## Current status (October 2026)

- ✅ `packages/engine`: Shopify + Bosta connectors, every payment method (COD, card, deposit, BNPL, bank transfer) with `cashToCollect`, resilience, adaptation, outbox — 85 tests incl. chaos with mixed payments and a 30-seed sweep.
- ✅ `packages/db`: migrations `0001_core` + `0002_commerce_os` (payments, purchasing, inbox, channels, finance, reports, webhooks, POS) with RLS on every tenant table — 8 tests.
- ✅ Docs: business model (full commerce OS), product (22 modules), payments, automation platform, architecture, data model, API, integrations, security, design, infra, 22 module specs, ADRs.
- ✅ Designed module library v2 (22 modules, PDF) — built outside this repo from the same content.
- ✅ `design/prototype.html`: approved UI direction.
- ✅ CI: typecheck + tests + gitleaks on every PR (E1-1).
- ✅ `packages/shared`: canonical types, zod schemas, money, phones (E1-2).
- ✅ `apps/api` skeleton: config, redacting logger, problem+json, health, OpenAPI (E1-3).
- ✅ DB layer: Kysely, migration runner, `withTenant`, real-Postgres CI (E1-4).
- ✅ Auth: Firebase token guard, tenant membership, roles, MFA, `/me` (E1-5).
- ✅ Signup: `POST /v1/tenants` with country defaults (E1-6).
- ✅ Team: invitations by email/phone, roles, disable, remove (E1-7).
- ✅ Domain events: transactional outbox, exactly-once consumers, worker (E1-8).
- ✅ Audit log: append-only, tenant-scoped, same-transaction (E1-9).
- ✅ Secrets: envelope encryption with Cloud KMS (E1-10).
- ✅ Engine tables tenant-scoped under RLS (E2-1).
- ✅ Engine per tenant from connections + KMS secrets; isolated circuits/buckets; platform job runner (E2-2).
- ✅ Store orders land in `orders`/`order_lines`/`customers`, PII encrypted, events emitted (E2-3).
- ⏭️ **Next:** E2-4 (learned data → `connections.learned`); E1-11 waits for GCP project details.

---

## Phase 0 — Discovery (months 0–1) — business tasks, not code

- [ ] D-1 Interview 15 merchants (10 Brandita clients first; mix of COD-heavy and prepaid-heavy); record payment mix, RTO, fees, tools used today, willingness to pay → `docs/research/interviews.md`
- [ ] D-2 Price test (Van Westendorp) → update `docs/01-business-model.md` §8
- [ ] D-3 Apply: Meta business verification, WhatsApp Tech Provider, Shopify Partner + protected data L2, Bosta API, J&T API, Paymob merchant; shortlist the second gateway
- [ ] D-4 Choose SMS/voice vendor and WhatsApp route (direct vs BSP) → ADR
- [ ] D-5 Pick 10 design partners; sign pilot agreement (3 months free for case study)
- [ ] D-6 Trademark check for the name in EG, KSA, UAE
- **Gate 1:** pains and price validated.

---

## Phase 1 — MVP build (months 1–5)

### E1 · Foundations

- [x] **E1-1** `S` Init git, GitHub repo, branch protection; `ci.yml` (install, typecheck, test all workspaces); Renovate; gitleaks. *Accept:* PR shows green checks running engine + db tests. *Done:* `.github/workflows/ci.yml`, `renovate.json`, `.gitleaks.toml`; branch protection rules listed in `docs/09` §4 (applied by a repo admin).
- [x] **E1-2** `M` `packages/shared`: move canonical types from engine (`core/model.ts`), add zod schemas, `Money` helpers (`toMinor`, `fromMinor`, currency decimals table incl. 3-decimal currencies), phone normalization (EG, KSA, UAE). Engine imports from shared. *Accept:* engine tests still pass; money helpers 100% covered. *Done:* `@mizan/shared` (model, money, phone, schemas), 122 tests, coverage gate on `money.ts` in `vitest.config.ts`; 30-seed chaos sweep green.
- [x] **E1-3** `M` `apps/api` skeleton: NestJS (latest stable), config validation (zod), structured logger with PII redaction, problem+json error filter, health endpoint, OpenAPI at `/v1/openapi.json`. *Accept:* `npm run dev -w @mizan/api` serves `/health`; invalid env fails fast with a clear message. *Done:* `apps/api` on NestJS 12 (ESM): `platform/config.ts`, pino logger with two-layer PII redaction, problem+json filter (AR/EN titles), `ZodPipe`, `/health`, `/v1/openapi.json` (3.1, zod components), worker stub; 35 tests.
- [x] **E1-4** `M` DB layer: Kysely (or Drizzle — pick, write ADR-0012) + migration runner over `packages/db/migrations`; separate migrator and app roles; transaction helper that sets `app.tenant_id`. *Accept:* integration test proves a request for tenant A cannot read tenant B. *Done:* ADR-0012 (Kysely); `@mizan/db` runner (checksums, advisory lock, `mizan-db migrate`), `0003_app_role`, codegen'd `schema.ts`, PGlite dialect, `withTenant`/`withoutTenant`; API `Database` + `/health/ready`; isolation proven on PGlite and real PostgreSQL 16 (CI service).
- [x] **E1-5** `M` Auth: Firebase ID token guard, `X-Tenant-Id` membership check, role decorator `@Roles(...)`; `/me`. *Accept:* tests with mocked Firebase verifier for each role. *Done:* `FirebaseTokenVerifier` (jose, Google JWKS; tested with locally signed tokens), global `AuthGuard` (`@Public`, `@NoTenant`, `@Roles`, `@Auth`), MFA for owner/admin, user upsert on first sign-in, `GET /v1/me`; migration 0004 `member_self_read`; role matrix tests for all 7 roles.
- [x] **E1-6** `S` Tenants + signup: `POST /tenants`, owner membership, default warehouse, default settings by country. *Accept:* creating an EG tenant sets EGP, Africa/Cairo, ar-EG. *Done:* `POST /v1/tenants` + `GET /v1/tenant`; `COUNTRY_DEFAULTS` for EG, SA, AE, KW, QA, BH, OM, JO, MA in `@mizan/shared`; one RLS-scoped transaction creates tenant, owner membership and default warehouse; slug derivation with collision retry and reserved words; 10 owned stores per account.
- [x] **E1-7** `M` Members and invites (email/phone), role change, disable. *Accept:* invited agent can sign in and sees only agent routes. *Done:* migration 0005 `invitations` (RLS + `invitee_read`), invite/revoke/accept, `GET /v1/members`, `PATCH`/`DELETE /v1/members/:userId` with lock-out guards; acceptance requires a verified email or OTP phone matching the invitation; `/me` lists pending invitations.
- [x] **E1-8** `M` Domain events + outbox writer in the same transaction; dispatcher in `worker.ts`; idempotent consumers by event id. *Accept:* a crash between commit and dispatch still delivers the event once. *Done:* migration 0006 (dispatch columns, `event_deliveries`, `mizan_worker` role + policy), `EventsService.emit`, `@EventConsumer`, `EventDispatcher` (leases, SKIP LOCKED, per-consumer exactly-once, backoff, dead letters), `worker.js`; tenant and member changes emit events; crash tests at every step.
- [x] **E1-9** `S` Audit log service; log sensitive actions (`connection.*`, `member.*`, `customer.pii_viewed`, exports). *Done:* migration 0007 (audit_log RLS — it was missing — and append-only for the app role), `AuditService.record(trx, …)` in the same transaction, `AUDIT_ACTIONS` catalogue, tenant and member actions with IP, `GET /v1/audit-log`. `connection.*`, `customer.pii_viewed` and exports are recorded when those modules land.
- [x] **E1-10** `M` Secrets service: envelope encryption with Cloud KMS (local: static dev key), `secrets` table, rotation. *Accept:* plaintext never in DB or logs (test greps logs). *Done:* `SecretsService` (create/read/rotate/delete/rewrapStale), `CloudKmsKeyWrapper` (REST + metadata token), `LocalKeyWrapper` for dev, `SecretValue`; KMS required and dev key refused in production; tests grep DB bytes and captured logs, prove AAD binding and tamper detection.
- [ ] **E1-11** `M` `infra/` Terraform for staging (Cloud Run api/worker/web, Cloud SQL, Secret Manager, KMS, Storage, Scheduler); `deploy-staging.yml`.

### E2 · Engine inside the platform

- [x] **E2-1** `M` Add `tenant_id` + `connection_id` to engine jobs and records; `SqlStore` uses the platform tables from `0001_core.sql`. *Accept:* all engine tests pass (85 at the time); chaos suite green. *Done:* migration 0008 (tenant_id NOT NULL + FKs, keys unique per tenant, `connection_id` on jobs, RLS on all three tables, `worker_claim` policy), tenant-scoped `SqlStore`, `tenantQueryClient`; the engine's full flow runs on the platform schema for two tenants with identical Shopify ids; 30-seed chaos sweep green.
- [x] **E2-2** `M` Connection resolver: worker loads connection + decrypted secret per job; per-connection circuit and rate bucket. *Accept:* two tenants with two Shopify stores sync independently; one store's 429s do not slow the other. *Done:* `@mizan/engine` is a library (+ `@mizan/engine/testing` fakes); `ConnectionResolver` (connections + decrypted JSON credentials), `EngineRegistry` (one engine per tenant → own circuits and rate buckets, 10-min TTL, `invalidate`), `EngineJobRunner` (due tenants as `mizan_worker`, one tick per tenant in flight, never waits for a slow tenant) in `worker.js`; `WORKER_IN_PROCESS` replaces `EVENTS_DISPATCH_IN_PROCESS`.
- [ ] **E2-7** `M` Several stores per tenant: scope the engine store per store connection (records, cursors, jobs) and route jobs by `connection_id`, so one tenant can run two Shopify stores (plan limit "stores"). Today the resolver refuses a second Shopify connection with `store_not_connected`.
- [x] **E2-3** `M` Map engine events to domain events (`order.ingested` → `order.created` …) and persist canonical orders into `orders`, `order_lines`, `customers` (with phone hash). *Accept:* replaying the same webhook 3× creates one order. *Done:* engine `hooks.onOrder` (awaited in the ingest job; platform failures retry as `transient`), `OrderProjector` (upsert by connection + external id, line sync, customer by phone hash, `order_events` timeline, `order.created/updated/cancelled` in the same transaction), `PiiCipher` for personal data. Shipment events → domain events land with the shipments table in E7-1.
- [ ] **E2-4** `S` Persist engine-learned data (status codes, city aliases, query variants) into `connections.learned`.
- [ ] **E2-5** `S` Admin integration routes: health, dead letters, replay, resolve city (port from engine `server.ts` `/ops/*`).
- [ ] **E2-6** `S` Persist engine payment fields (`paymentMode`, `paymentStatus`, `received`, `outstanding`, `refunded`) into `orders` and `payments`; map `order.awaiting_payment` and `order.payment_changed` to domain events.

### E3 · Shopify app

- [ ] **E3-1** `M` OAuth install flow (`/connections/shopify/install` + callback): HMAC + `state` verification, token exchange, store `secrets`, create `connections` row. *Accept:* install on a dev store creates an active connection.
- [ ] **E3-2** `S` Register webhooks on install (orders/create, orders/updated, orders/cancelled, products/update, app/uninstalled) via GraphQL `webhookSubscriptionCreate`, API version 2026-10.
- [ ] **E3-3** `M` **Mandatory compliance webhooks** `customers/data_request`, `customers/redact`, `shop/redact` → `privacy_requests` + jobs that export / anonymize / delete. *Accept:* tests for each topic with valid and invalid HMAC; redact removes PII but keeps order totals.
- [ ] **E3-4** `S` `app/uninstalled` → connection `disconnected`, secret deleted, jobs stopped.
- [ ] **E3-5** `M` Initial backfill: last 60 days of orders + all products on connect, paged, cost-aware. *Accept:* progress visible in UI; resumable after restart.

### E4 · Web app foundation

- [ ] **E4-1** `M` `apps/web`: Next.js (App Router, latest stable), Tailwind with tokens from `docs/08`, fonts via `next/font`, next-intl AR/EN, RTL switch, dark mode. *Accept:* lint rule blocks physical direction classes; Arabic default.
- [ ] **E4-2** `M` Firebase sign-in (email + phone OTP), tenant switcher, protected layout with side rail (as prototype).
- [ ] **E4-3** `M` UI kit from `docs/08` §5 with Storybook or a `/ui` gallery page in both directions.
- [ ] **E4-4** `S` Typed API client generated from OpenAPI; TanStack Query; error toasts from problem+json codes.
- [ ] **E4-5** `M` Onboarding wizard: connect store → connect courier → set COGS → first order. *Accept:* time-to-first-value measured (product events).

### E5 · M1 Orders

- [ ] **E5-1** `M` `GET /orders` with filters, search, cursor pagination; order list screen with status chips + counts.
- [ ] **E5-2** `M` Order detail screen (timeline, lines, customer masked + reveal with audit, map pin).
- [ ] **E5-3** `M` Duplicate detection (phone hash + variant within 48 h, configurable) → `order.duplicate_found`; merge endpoint + UI.
- [ ] **E5-4** `M` Bulk actions (assign, cancel, tag, ship) as jobs with progress.
- [ ] **E5-5** `S` Manual order creation.
- [ ] **E5-6** `M` EasyOrders connector (via `/new-connector`), fake + chaos suite.
- [ ] **E5-7** `M` WooCommerce connector.
- [ ] **E5-8** `S` Nightly reconciliation: store order count vs Mizan per connection → alert on gap.

### E6 · M2 Confirmation + M14 scripts (basic)

- [ ] **E6-1** `M` Risk score v1 with method-specific signals (COD: customer history, duplicates, address, value vs average, phone validity; prepaid: name/address mismatch, velocity, value, past chargebacks) with reasons; `order.scored`. *Accept:* reasons shown in UI; score deterministic in tests.
- [ ] **E6-2** `S` Routing by payment method and score band: COD → auto / bot / agent / hold; prepaid → approve / review; bank transfer → wait. Tenant-configurable.
- [ ] **E6-3** `M` Agent queue screen: next order, script panel, click-to-call (`tel:`), outcome buttons, retries scheduled.
- [ ] **E6-4** `L` WhatsApp Cloud API connector: Embedded Signup v4, webhook verification, send template, receive button replies + location; opt-in tracking. Split into 3 stories before starting.
- [ ] **E6-5** `M` Script model + editor v1 (blocks, variables `{{customer.first_name}}`, `{{order.total}}`, branches on button reply), Egyptian dialect pack, preview with a real order.
- [ ] **E6-6** `S` Confirmation analytics: rate by channel (auto, bot, agent).

### E7 · M3 Shipping

- [ ] **E7-1** `S` Ship endpoint → engine `bosta.createShipment` job; shipment row; label URL.
- [ ] **E7-2** `M` Shipping screen: ready to ship, courier choice, bulk ship, print labels (A6/A4 PDF merge).
- [ ] **E7-3** `S` Tracking list + needs-review queue (unknown statuses, unresolved cities).
- [ ] **E7-4** `M` Courier scorecard by zone (delivery rate, RTO, days to remit).
- [ ] **E7-5** `M` J&T connector (once API access is granted).
- [ ] **E7-6** `S` CSV import of courier statuses (fallback for couriers without API).

### E8 · M4 Warehouse + ops app

- [ ] **E8-1** `M` Products/variants screens, COGS entry (bulk CSV), barcodes; sync with Shopify (field ownership).
- [ ] **E8-2** `M` Stock levels, movements, reservations on confirm, release on cancel; oversell block.
- [ ] **E8-3** `M` `POST /v1/ops/sync` batch endpoint, exactly-once by `opId`.
- [ ] **E8-4** `L` `apps/ops` Flutter: sign-in, pick list, scan-to-pack (camera), offline queue (drift), sync, AR/EN. Prototype offline sync first (riskiest). Split before starting.
- [ ] **E8-5** `S` Low-stock alerts; push stock to Shopify via engine `updateProduct`.

### E9 · M5 Profit engine

- [ ] **E9-1** `M` Cost rules (agent, packaging, COD %, courier rate card), FX daily job.
- [ ] **E9-2** `L` Profit service: recompute `order_pnl` on events (rules in `docs/04` §5); provisional vs final. Property-based tests for sums.
- [ ] **E9-3** `S` MVP ad cost: daily ad spend entered manually or CSV per store → spread over delivered orders.
- [ ] **E9-4** `M` Home screen: net profit yesterday / 30 days, margin, RTO rate, cash in transit, leaks.
- [ ] **E9-5** `M` Profit breakdown by product, store, courier, country, day; CSV export.

### E10 · M6 Returns and tickets

- [ ] **E10-1** `M` Tickets CRUD + types + statuses; order link.
- [ ] **E10-2** `M` Exchange creates linked order + return shipment; partial delivery; open-box (المعاينة) outcome.
- [ ] **E10-3** `S` Inspection (restock / damaged / write-off) in web + ops app → stock movement + P&L update.

### E11 · M13 Automation core

- [ ] **E11-1** `M` Automation runtime: subscribe to domain events, evaluate conditions (JSON rules), run actions (`order.set_status`, `order.assign`, `order.add_tag`, `whatsapp.send_script`, `notify`), one run per event.
- [ ] **E11-2** `M` Built-in recipes for orders, verification, payments and fulfilment (see `docs/13-automation-platform.md` §3), recipe gallery UI with enable switch, run log.
- [ ] **E11-3** `S` One catalogue registry in code for triggers, conditions and actions; served at `GET /v1/catalog`.

### E14 · M15 Payments and refunds

- [ ] **E14-1** `M` Payment ledger service over `payments` (signed lines, invariants, `paid_minor`/`refunded_minor` maintained in the same transaction); ledger panel on order detail. *Accept:* property tests prove ledger lines always sum to the order balance.
- [ ] **E14-2** `L` Paymob connector (via `/new-connector`): payment links (full, deposit, balance), webhook signature, transaction re-read, refunds, transaction report. Fake + chaos suite. Split before starting.
- [ ] **E14-3** `M` COD-to-prepaid conversion: link from verification queue and automation action `order.convert_to_prepaid`; shipment COD amount updated or re-booked.
- [ ] **E14-4** `M` Refunds: approval thresholds, destinations (original method, store credit, bank transfer), audit; ticket integration (M6).
- [ ] **E14-5** `S` Disputes: record chargebacks from gateway webhooks; evidence pack PDF (order, tracking, chat, address).
- [ ] **E14-6** `S` Payments list screen with filters (unpaid, COD due, refunds, disputes) and payment mix on the home dashboard.

### E15 · M20 Reports core

- [ ] **E15-1** `M` Semantic metric layer in code (`delivered rate`, `prepaid share`, `net profit`, `days of cover` …) with tests; `GET /v1/metrics`.
- [ ] **E15-2** `M` Built-in dashboards: home, operations, profit, payments, stock (AR/EN); CSV/Excel export.

### E12 · Billing and plans

- [ ] **E12-1** `M` Plan limits (orders/month, stores, users) enforced with soft warnings + upgrade prompts.
- [ ] **E12-2** `M` Paymob subscription billing for EGP; invoices.
- [ ] **E12-3** `S` Usage metering (orders, messages) per tenant per month.

### E13 · Launch readiness

- [ ] **E13-1** Production Terraform, `deploy-prod.yml`, backups + restore drill.
- [ ] **E13-2** Monitoring dashboards + alerts (`docs/09` §5); status page.
- [ ] **E13-3** Privacy policy, terms, DPA published; cookie notice.
- [ ] **E13-4** Penetration test; fix findings.
- [ ] **E13-5** Shopify App Store submission.
- **Gate 2:** MVP live with 10 pilot merchants.

---

## Phase 2 — Pilot (months 5–7)

- [ ] P-1 Onboard 10 design partners (done-for-you).
- [ ] P-2 Baseline and weekly measurement of profit per completed order, RTO (COD), chargebacks (prepaid), prepaid share, automation share.
- [ ] P-3 Fix-and-harden sprint per feedback; drift report reviewed weekly.
- [ ] P-4 First 3 case studies (AR/EN).
- **Gate 3:** results proven; 30 paying merchants.

## Phase 3 — V2 (months 7–12)

- **M7 Attribution:** Meta/TikTok/Snap spend import; UTM + click-id capture; cost per delivered order; CAPI confirmed + delivered events (< 1 h after delivery).
- **M8 Reconciliation:** courier, gateway, BNPL, bank and marketplace payouts (API or file); auto-match; gaps; money in transit by source and age.
- **M9 CRM, loyalty and marketing:** profiles, segments, loyalty points and tiers, store credit, campaigns with opt-in.
- **M16 Purchasing:** suppliers, POs, reorder suggestions, receiving in the ops app, landed cost.
- **M17 Inbox:** WhatsApp, Instagram, Messenger, email, web chat; SLAs; AI drafts.
- **M18 Channels:** Noon or Amazon first; listings, stock buffers, price rules, payouts.
- **M19 Finance:** expenses, business P&L, VAT, period close, accounting sync (Zoho Books / Odoo / Daftra), ZATCA Phase 2, Egypt ETA.
- **M20 builder** and schedules. **M21 developer platform:** webhooks out, logs, n8n/Zapier/Make, Google Sheets.
- **More gateways:** Kashier, Fawry, Moyasar, Tap, HyperPay, Checkout.com, Stripe; BNPL (Tabby, Tamara, valU).
- **M10 Agents:** performance dashboards, commission rules, payout export.
- **M13 V2:** visual When → If → Then canvas. **M14 V2:** A/B tests on delivered rate; Gulf dialect pack.
- **KSA:** Salla, Zid, SMSA, SPL, Aymakan; KSA hosting decision.
- **Gate 4:** KSA merchants live and retained.

## Phase 4 — V3 (months 12–18)

- **M11 Risk network** (after legal review), **M12 courier routing + AI analyst**, **M22 Retail POS** (reuses the ops app's offline layer), AI steps in automations, Maghreb (YouCan, Darija/French) and Levant/Iraq.
