# Mizan integration engine

Self-healing connectors between Mizan, **Shopify** and **Bosta**. Orders flow in, shipments go out, tracking and cash status come back, and product prices and stock stay in sync, even when the providers throttle, time out, drop responses, send duplicates out of order, or change their payloads.

```
npm install
npm test          # 57 tests, including end-to-end chaos runs at 10%, 25% and 50% failure rates
npm run demo      # narrated run against misbehaving fake Shopify and Bosta servers, no credentials needed
npm run typecheck
```

---

## What it does

| Flow | Trigger | Result |
| --- | --- | --- |
| Order intake | Shopify `orders/*` webhook, or the 5-minute poll | Canonical order saved in Mizan |
| Ship | Order tagged `mizan-confirmed` (set by the confirmation module) or `POST /ops/orders/ship` | One Bosta delivery, COD amount from the order |
| Fulfil | Delivery created | Shopify fulfillment with Bosta tracking number and link; customer notified |
| Track | Bosta webhook, or the 5-minute poll of active deliveries | Mizan shipment status updated |
| Settle | Delivered (COD) | Shopify order marked paid |
| Return | Returned to business | Shopify order tagged `mizan-returned` |
| Price and stock | `engine.updateProduct(...)` from Mizan | Shopify variant prices and inventory updated |
| Admin edits | Shopify `products/update` | Mizan-owned fields restored, Shopify-owned fields accepted |

---

## How it stays correct when providers misbehave

```
 Shopify / Bosta webhooks ─▶ verify ─▶ dedupe ─▶ ┐
                                                 ├─▶ outbox job ─▶ worker ─▶ connector ─▶ provider
 5-minute reconciliation polls ─────────────────▶ ┘        │            │
                                                       retry with    resilient HTTP:
                                                       backoff, or   circuit → rate limit →
                                                       dead-letter   timeout → classify → retry
```

**1. Every write is a job.** Webhooks are verified, de-duplicated and acknowledged in milliseconds. All real work runs as outbox jobs with idempotency keys, leases (a crashed worker's job is picked up again), jittered backoff, and a dead-letter queue that can be replayed after a fix. On PostgreSQL, jobs are claimed with `FOR UPDATE SKIP LOCKED`, so several instances can share one database.

**2. One error taxonomy.** Adapters classify every failure as `rate_limited`, `transient`, `timeout`, `circuit_open`, `auth`, `permission`, `not_found`, `validation`, `conflict`, `schema_drift` or `permanent`. The type alone decides what happens: wait and retry, re-read and retry, stop and alert, or dead-letter for a person.

**3. Resilient HTTP.** Each request goes through a circuit breaker per provider, an adaptive rate limiter, a timeout, and retries with full-jitter exponential backoff that honour `Retry-After`. A *non-idempotent* request that times out is never re-sent blindly: the outcome is unknown, so the caller verifies first.

**4. Rate limits that adapt.** Shopify reports its real budget in every response (`extensions.cost.throttleStatus`); the limiter re-syncs to it and slows down before Shopify throttles. Bosta does not publish limits, so the limiter starts conservative, halves its pace on a 429, and creeps back up on success. It finds the real limit on its own.

**5. Tolerant reading.** Adapters read fields by ranked candidate paths instead of fixed ones (`shippingAddress.phone` → `customer.defaultPhoneNumber.phoneNumber` → `customer.phone` …). A moved field still maps and is logged as drift. Values that changed type are coerced where safe (`"45"`, `{ code: 45 }` → `45`). Only a missing *required* field stops a job, and the error names the field and the paths tried.

**6. Query fallback across API versions.** Shopify ships a version every quarter and retires fields. Each GraphQL operation has ordered variants. If Shopify rejects a field, the client switches to the next variant, remembers the switch, and records drift. If Shopify silently serves a newer version than pinned, that is detected from `X-Shopify-API-Version` and reported.

**7. Shape watch.** Every endpoint's response structure is fingerprinted. Removed or retyped keys are reported with exact paths, often before anything breaks.

**8. Status mapping that learns.** Bosta's public sources disagree on numeric state codes (its own SDKs span API v0, v1 and v2), so no numeric code is trusted by default. Labels map the status ("Delivered", "تم التوصيل" …). When a code arrives with a label, the pair is learned and persisted. Code-only events then use learned codes, but **terminal statuses (delivered, returned, cancelled, lost) are only trusted from a code after three consistent confirmations or an ops override**. Unknown statuses never guess; the shipment keeps its last good status and is flagged for review.

**9. Never twice, never backwards.**

- **Bosta creates:** Bosta's create call has no idempotency key. On any retry, or after a timeout, the engine searches Bosta by `businessReference` (the Mizan order ID) and adopts the existing delivery instead of creating a second one.
- **Shopify fulfillments:** before creating one, the engine checks whether a fulfillment with that tracking number already exists.
- **Shopify inventory:** stock writes are compare-and-set with Shopify's `@idempotent` key (required since 2026-04). If stock changed between the read and the write, the engine re-reads and retries.
- **Out-of-order events:** an ordering guard drops stale events and never moves a shipment out of a terminal status.

**10. Thin webhook, fat fetch.** A webhook is a hint, not a fact. The engine re-reads the order, product or delivery from the API before acting. A forged, partial or stale webhook cannot move an order by itself.

**11. Field ownership, no sync loops.** Each synced field has an owner (default: Mizan owns price, compare-at price and stock). When Shopify reports a value that differs from Mizan's desired value, the field's owner wins:

- **Mizan-owned field:** someone edited it in Shopify admin, so it is restored.
- **Shopify-owned field:** Shopify's value is accepted into Mizan.

Mizan's own writes echo back with identical values and are ignored, so there is no ping-pong.

**12. Reconciliation.** Polls of recent orders (with an overlap window) and of active deliveries run every five minutes and use the same idempotency keys as the webhook path. A missed webhook delays an update by one poll; it is never lost.

**13. Addresses that resolve themselves.** Free-typed cities ("Nasr City", "6th of October", "المنصورة", "Al Iskandariyah") are matched to Bosta's cities by normalized Arabic and English names, built-in Egyptian aliases, and containment. If none match, the job stops with the three closest suggestions. Ops picks the city once (`POST /ops/cities/resolve`), the job replays, and every later order from that place resolves on its own.

### What the tests prove

- 57 tests cover the resilience layer, field resolution, shape watching, status ordering, city and phone normalization, both connectors, and the PostgreSQL store (on PGlite, including a restart mid-flow).
- End-to-end chaos runs ship 25 orders with **10%, 25% and 50% of all provider calls failing** (5xx, hangs, dropped connections, throttling, 429s), plus lost, duplicated and out-of-order webhooks.
- Required result in every run: one delivery per order, one fulfillment per order with the right tracking number, every shipment delivered, every COD order marked paid exactly once, prices and stock in sync, and an empty dead-letter queue.
- A sweep of 30 random seeds at 50% failure passes the same checks.
- The chaos runs found one real bug: a circuit breaker could stay stuck half-open when its trial request was answered with a 429. It is fixed, and a regression test is included.

---

## Project layout

```
src/
  core/        canonical model, error taxonomy, injected runtime (clock, fetch, logger)
  resilience/  http (send), circuit breaker, adaptive token bucket, backoff
  adapt/       tolerant resolver, drift monitor, shape watch, status mapper + ordering guard
  sync/        outbox store (memory + PostgreSQL), worker
  connectors/
    shopify/   GraphQL client (cost throttle, version watch, query variants), mapper, webhooks, connector
    bosta/     connector (duplicate-safe create, learning status map), cities, states
  engine/      MizanEngine: webhook intake, job handlers, product sync, reconciliation, health
  server.ts    HTTP entry point (webhooks, health, ops endpoints, worker loop)
test/          fakes (clock, Shopify, Bosta) and test suites
examples/      demo.ts
```

---

## Going live

### 1. Shopify

Create an app in the Shopify Dev Dashboard (or a custom app for a single store) with these Admin API scopes:

| Scope | Why |
| --- | --- |
| `read_orders` (`read_all_orders` for history older than 60 days) | Order intake and reconciliation |
| `read_products`, `write_products` | Product reads, price updates |
| `read_inventory`, `write_inventory` | Stock reads and compare-and-set writes |
| `read_merchant_managed_fulfillment_orders`, `write_merchant_managed_fulfillment_orders` | Fulfil with tracking |
| `read_customers` | Customer name, phone, email on orders |

**Protected customer data:** reading customer name, phone and address on orders needs **Level 2** access, requested field by field in the app's API access settings. Without it Shopify returns those fields empty and confirmation cannot work. Request it first; it is the longest lead time.

Webhook subscriptions (API version 2026-10): `orders/create`, `orders/updated`, `orders/cancelled`, `products/update`, `app/uninstalled`, all to `https://<your-host>/webhooks/shopify`.

### 2. Bosta

API key from the Bosta business dashboard. The engine sends it raw in the `Authorization` header (no `Bearer`), against `https://app.bosta.co/api/v2` by default. Set `BOSTA_BASE_URL` for staging. Webhooks: each delivery is created with `webhookUrl = PUBLIC_URL/webhooks/bosta?token=BOSTA_WEBHOOK_SECRET`.

**Confirm with Bosta before going live:** these vary between Bosta's own SDKs, so the adapter tolerates several forms, but confirm against the API reference in your business account:

- The numeric delivery state codes. Fill `codes` in `src/connectors/bosta/states.ts` to start with trusted codes on day one.
- The `deliveries/search` request body.
- Which `dropOffAddress` city field your account expects (`city`, `cityCode` or `cityId`). This is configurable.
- The public tracking URL format (`BOSTA_TRACKING_URL_TEMPLATE`).

### 3. Run

```
cp .env.example .env    # fill in values
npm install pg          # PostgreSQL driver for production
DATABASE_URL=postgres://… npx tsx src/server.ts
```

The schema migrates itself on start. Run two or more instances behind a load balancer; job claiming is lock-free and lease-based.

---

## Operating it

- `GET /health` shows circuit state and rate budget per provider, pending and dead-letter counts, the last 20 dead letters with their reasons, and the drift report ranked by frequency.
- **Dead letters** are jobs that need a person: an unrecognised city, a cancelled order, a revoked token, a missing scope, a field that disappeared. Fix the cause, then `POST /ops/jobs/:id/replay`.
- **Drift report:** the adapter backlog. Fallbacks keep working, but each entry is a provider change worth absorbing into the adapter before the fallback runs out.
- **Events** (`engine.on(...)`) feed Mizan's activity log and alerts:
  - `order.ingested`, `shipment.created`, `order.fulfilled`, `shipment.status`, `order.paid`
  - `product.pushed`, `product.conflict`
  - `shipment.needs_review`, `job.dead`, `connection.needs_attention`, `drift`

---

## Adding the next connector (J&T, Aramex, Salla, Zid …)

1. Write a connector class that calls `send()` with its own circuit and bucket, and classifies body-level errors in `inspect`.
2. Map to and from the canonical model with `Resolver` candidate paths. Never read a payload field directly.
3. For couriers, give `StatusMapper` a label table, and keep numeric codes empty until confirmed from the provider.
4. Make every write safe to repeat: use an idempotency key where the provider supports one, and look up before creating where it does not.
5. Add a fake server with the provider's real quirks and failure modes, and run the chaos suite against it.
