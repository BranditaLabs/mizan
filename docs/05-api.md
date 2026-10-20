# 05 — API conventions and endpoints

The REST API serves the web dashboard, the ops app and merchants' own integrations. Base URL: `https://api.<domain>/v1`.

## 1. Conventions

| Topic | Rule |
| --- | --- |
| Format | JSON, `camelCase` fields; UTF-8 |
| Auth (users) | `Authorization: Bearer <Firebase ID token>` + `X-Tenant-Id: <uuid>` (must match an active membership). ✅ `AuthGuard` (E1-5): every route is protected unless `@Public()`; `@NoTenant()` routes skip the header; `@Roles(...)` narrows. Codes: `unauthorized`, `token_invalid`, `token_expired`, `tenant_header_required`, `invalid_tenant_id`, `not_a_member` (same answer for unknown store, invited, disabled), `tenant_inactive`, `mfa_required`, `insufficient_role` |
| Auth (integrations) | `Authorization: Bearer mz_live_…` API key; tenant comes from the key; scopes checked per route |
| Money | `{ "amount": "1150.00", "currency": "EGP" }` (decimal string) |
| Dates | ISO 8601 UTC (`2026-10-20T14:03:00Z`) |
| IDs | UUID strings; external IDs as `externalId` |
| Pagination | Cursor: `?limit=50&cursor=<opaque>` → `{ data: [...], nextCursor: "..." \| null }`. Max limit 200 |
| Filtering | `?status=confirmed&status=shipped&placedFrom=…&placedTo=…&q=…` (repeat a key for OR) |
| Sorting | `?sort=-placedAt` |
| Idempotency | All `POST` that create or trigger side effects accept `Idempotency-Key` (stored 24 h; same key + same body → same response; same key + different body → 409) |
| Concurrency | Mutable resources return `ETag`; `PATCH` accepts `If-Match` → 412 on conflict |
| Errors | RFC 9457 `application/problem+json` (below) |
| Language | `Accept-Language: ar` or `en` → localized `title` / `detail` in errors |
| Rate limits | Per API key and per user: `RateLimit-Policy` / `RateLimit` headers; 429 with `Retry-After` |
| Versioning | Path `/v1`. Additive changes only within v1. Breaking changes → `/v2` with 6 months overlap |

### Error format

✅ Implemented in `apps/api/src/platform/http/problem.filter.ts` (E1-3). Codes emitted today: `bad_request`, `unauthorized`, `forbidden`, `not_found`, `method_not_allowed`, `conflict`, `precondition_failed`, `payload_too_large`, `validation_failed` (zod, with `errors[]`), `rate_limited`, `internal_error` (generic; details only in redacted logs), `service_unavailable`, plus any module code thrown with `ProblemError`. `title` is Arabic by default, English with `Accept-Language: en`. Every response carries `X-Request-Id`.

```json
{
  "type": "https://docs.mizan.app/errors/validation",
  "title": "Validation failed",
  "status": 422,
  "code": "validation_failed",
  "detail": "phone is not a valid Egyptian mobile number",
  "errors": [{ "path": "customer.phone", "code": "invalid_phone" }],
  "requestId": "req_01J…"
}
```

Error `code` values are stable and documented; UI maps them to AR/EN messages.

## 2. Endpoints (MVP)

### Platform

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/me` | ✅ Current user (created on first sign-in; profile follows Firebase) and memberships across stores with role, status, country, currency, locale, timezone. No `X-Tenant-Id` |
| POST | `/tenants` | Create tenant (signup) — creator becomes owner |
| GET / PATCH | `/tenant` | Tenant settings (currency, timezone, locale) |
| GET / POST | `/members` · `/members/invite` | Team; invite by email or phone |
| PATCH / DELETE | `/members/{userId}` | Role change, remove |
| GET / POST / DELETE | `/api-keys` | Manage API keys (owner/admin) |

### Connections

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/connections` | All connections and health (circuit, last sync, drift count) |
| GET | `/connections/shopify/install?shop=…` | Start Shopify OAuth |
| GET | `/connections/shopify/callback` | OAuth callback (HMAC + state verified) |
| POST | `/connections/{provider}` | Key-based connect (Bosta, EasyOrders, WooCommerce keys) |
| POST | `/connections/{id}/test` | Live credential check |
| DELETE | `/connections/{id}` | Disconnect, revoke webhooks, delete secret |

### Orders (M1) and verification (M2)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/orders` | List / filter / search |
| GET | `/orders/{id}` | Order with lines, customer, history, shipments, P&L |
| POST | `/orders` | Manual order |
| PATCH | `/orders/{id}` | Edit address, items, notes (before shipping) |
| POST | `/orders/{id}/status` | `{ status, reason }` |
| POST | `/orders/bulk` | `{ action: assign\|confirm\|cancel\|ship\|tag, ids, params }` → job id |
| POST | `/orders/{id}/merge` | Merge duplicate into target |
| GET | `/confirmation/queue` | Agent queue (own or team) |
| POST | `/orders/{id}/confirmations` | Log an attempt `{ channel, outcome, notes }` |
| POST | `/orders/{id}/whatsapp` | Send confirmation script now |

### Shipping (M3)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/orders/{id}/ship` | `{ connectionId? }` → enqueues `createShipment` (idempotent per order) |
| GET | `/shipments` · `/shipments/{id}` | List, detail with events |
| POST | `/shipments/{id}/cancel` | Cancel with courier |
| GET | `/shipments/{id}/label` | PDF label (A6/A4) |
| POST | `/pickups` | Request pickup |
| GET | `/couriers/scorecard` | Delivery rate, RTO, days-to-remit by courier and zone |

### Warehouse (M4)

| Method | Path | Purpose |
| --- | --- | --- |
| GET / POST / PATCH | `/products` · `/variants` | Catalog, COGS, barcodes |
| GET | `/stock` | Levels by warehouse |
| POST | `/stock/movements` | Adjust, receive, transfer |
| POST | `/ops/sync` | **Ops app batch sync**: `{ deviceId, ops: [{ opId, type, payload, at }] }` → per-op result. Exactly-once by `opId` |
| GET | `/ops/pick-lists` | Packing queue |

### Profit (M5) and returns (M6)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/profit/summary?from&to` | Net profit, margin, components |
| GET | `/profit/breakdown?by=product\|store\|courier\|country\|day` | Grouped P&L |
| GET / POST | `/cost-rules` | Agent, packaging, fee rules |
| GET / POST / PATCH | `/tickets` | Complaints, exchanges, returns |
| POST | `/tickets/{id}/inspection` | `{ result: restock\|damaged\|write_off, lines }` |

### Automation (M13) and scripts (M14)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/automations/recipes` | Built-in recipes |
| GET / POST / PATCH | `/automations` | Create from recipe or custom; enable/disable |
| GET | `/automations/{id}/runs` | Run log |
| GET / POST / PATCH | `/scripts` | Draft, edit blocks |
| POST | `/scripts/{id}/preview` | Render with a real order |
| POST | `/scripts/{id}/publish` | Version + submit WhatsApp templates if needed |

### Payments (M15)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/orders/{id}/payments` | Payment ledger |
| POST | `/orders/{id}/payment-links` | `{ purpose: full\|deposit\|balance\|convert_cod, amount?, discountPct? }` |
| POST | `/orders/{id}/refunds` | `{ amount, destination, reason }` (approval rules apply) |
| GET | `/payments` · `/disputes` | Lists and filters |
| POST | `/disputes/{id}/evidence` | Submit evidence pack |

### Reconciliation (M8), purchasing (M16), inbox (M17)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/settlements` | Upload a payout file or trigger an API import (`source_type`) |
| GET | `/settlements/{id}` · `/reconciliation/gaps` | Lines and open gaps |
| GET / POST | `/suppliers` · `/purchase-orders` | Suppliers and POs |
| POST | `/purchase-orders/{id}/receipts` | Receive (ops app, exactly once) |
| GET | `/reorder-suggestions` | Reorder list |
| GET · POST | `/conversations` · `/conversations/{id}/messages` | Inbox queue and replies |

### Channels (M18), finance (M19), reports (M20), developers (M21), POS (M22)

| Method | Path | Purpose |
| --- | --- | --- |
| GET / PATCH | `/listings` | Listings, errors, buffers, channel prices |
| GET | `/finance/pnl` · `/finance/vat` | Business P&L, VAT report |
| GET / POST | `/expenses` | Expenses |
| POST | `/finance/periods/{id}/close` | Close a month |
| POST · GET | `/reports/query` · `/metrics` | Run reports on the semantic layer |
| GET / POST | `/webhook-subscriptions` · `/webhook-deliveries` | Webhooks out |
| POST | `/pos/sales` · `/pos/returns` · `/pos/shifts` | POS (V3) |
| GET | `/catalog` | Automation triggers, conditions and actions |

### Webhooks in (public, no user auth)

| Path | Verification |
| --- | --- |
| `POST /webhooks/shopify` | `X-Shopify-Hmac-SHA256` over raw body with app secret; dedupe `X-Shopify-Event-Id` |
| `POST /webhooks/shopify/gdpr` | Same HMAC; topics `customers/data_request`, `customers/redact`, `shop/redact` |
| `POST /webhooks/bosta/{connectionId}?token=…` | Per-connection secret token (Bosta does not sign) |
| `POST /webhooks/whatsapp` | `X-Hub-Signature-256` with app secret; GET verify challenge |
| `POST /webhooks/payments/{provider}/{connectionId}` | Provider signature (e.g. Paymob HMAC, Stripe signature); re-read the transaction from the provider before acting |
| `POST /webhooks/marketplaces/{provider}/{connectionId}` | Provider signature or notification verification |

### Webhooks out (merchant integrations, V2)

Merchants subscribe to Mizan events (`order.confirmed`, `shipment.delivered` …). Deliveries are signed `X-Mizan-Signature: t=<ts>,v1=<hmac-sha256>`, retried with backoff for 24 h, visible in a delivery log.

### Admin / integration ops

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/integrations/health` | Engine health per connection (from `engine.health()`) |
| GET | `/admin/integrations/dead-letters` | Jobs needing a person |
| POST | `/admin/integrations/jobs/{id}/replay` | Replay after a fix |
| POST | `/admin/integrations/cities/resolve` | Teach a city alias, replay waiting jobs |

## 3. OpenAPI

Generate the OpenAPI 3.1 document from NestJS decorators (`@nestjs/swagger`) and zod schemas in `packages/shared`. Publish at `/v1/openapi.json`; the web app generates its typed client from it.
