# 05 — API conventions and endpoints

The REST API serves the web dashboard, the ops app and merchants' own integrations. Base URL: `https://api.<domain>/v1`.

## 1. Conventions

| Topic | Rule |
| --- | --- |
| Format | JSON, `camelCase` fields; UTF-8 |
| Auth (users) | `Authorization: Bearer <Firebase ID token>` + `X-Tenant-Id: <uuid>` (must match an active membership). ✅ `AuthGuard` (E1-5): every route is protected unless `@Public()`; `@NoTenant()` routes skip the header; `@Roles(...)` narrows. Auth lookups are cached (H-6): a membership change made on another API instance applies within 10 s, on the same instance at once. Codes: `unauthorized`, `token_invalid`, `token_expired`, `tenant_header_required`, `invalid_tenant_id`, `not_a_member` (same answer for unknown store, invited, disabled), `tenant_inactive`, `mfa_required`, `insufficient_role`. Local development and `web-e2e` run against the Firebase Auth emulator: with `FIREBASE_AUTH_EMULATOR_HOST` set (refused in production) the API accepts its unsigned tokens, still checking issuer, audience, expiry and subject |
| Auth (integrations) | `Authorization: Bearer mz_live_…` API key; tenant comes from the key; scopes checked per route |
| Money | `{ "amount": "1150.00", "currency": "EGP" }` (decimal string) |
| Dates | ISO 8601 UTC (`2026-10-20T14:03:00Z`) |
| IDs | UUID strings; external IDs as `externalId` |
| Pagination | Cursor: `?limit=50&cursor=<opaque>` → `{ data: [...], nextCursor: "..." \| null }`. Max limit 200 |
| Filtering | `?status=confirmed&status=shipped&placedFrom=…&placedTo=…&q=…` (repeat a key for OR) |
| Sorting | `?sort=-placedAt` |
| Idempotency | All `POST` that create or trigger side effects accept `Idempotency-Key` (stored 24 h; same key + same body → same response; same key + different body → 409). ✅ (H-4) per caller; replays carry `Idempotency-Replayed: true`; a request still running → 409 `idempotency_key_in_progress`; failed attempts are not stored, so they can be retried with the same key |
| Concurrency | Mutable resources return `ETag`; `PATCH` accepts `If-Match` → 412 on conflict |
| Errors | RFC 9457 `application/problem+json` (below) |
| Language | `Accept-Language: ar` or `en` → localized `title` / `detail` in errors |
| Rate limits | Per API key and per user: `RateLimit-Policy` / `RateLimit` headers; 429 with `Retry-After`. ✅ (H-3) per IP 1200/min (checked before the token, so bad-token floods cost nothing) and per user 600/min, per API instance; `RateLimit: limit=600, remaining=599, reset=1`; `rate_limited` problem |
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
| POST | `/tenants` | ✅ Create tenant (signup) — creator becomes owner. Body `{ name, country, slug?, language? }`; country defaults (currency, timezone, locale, week start, phone country) from `@mizan/shared` `COUNTRY_DEFAULTS`; default warehouse; slug derived and de-duplicated. Errors: `slug_taken` (409), `tenant_limit_reached` (422, 10 owned stores), `validation_failed` |
| GET / PATCH | `/tenant` | Tenant settings (currency, timezone, locale). ✅ GET; PATCH next |
| GET / POST | `/members` · `/members/invite` | ✅ Team (members + pending invitations); invite by email or phone `{ email \| phone, role }` → invitation with `acceptUrl` to share. Owner/admin; only owners invite owners. Re-inviting refreshes. `already_member` (409) |
| PATCH / DELETE | `/members/{userId}` | ✅ `{ role?, status?: active\|disabled }`, remove. Guards: `cannot_change_self`, owners only by owners, `last_owner`. Disabled members are locked out on their next request |
| DELETE | `/invitations/{id}` | ✅ Revoke a pending invitation (owner/admin) |
| POST | `/invitations/{id}/accept` | ✅ Signed in, no `X-Tenant-Id`. Only when the caller's **verified** email or OTP phone matches; otherwise `invitation_not_found` (also for revoked/accepted/expired; 7-day TTL). `GET /me` lists `invitations` addressed to the caller |
| GET / POST / DELETE | `/api-keys` | Manage API keys (owner/admin) |
| GET / PATCH | `/onboarding` | ✅ Owner/admin (E4-5): steps `store` (with the history import's progress and `missingScopes` to approve), `courier`, `costs`, `firstOrder`; `milestones` from product events; `timeToFirstValueS` (signup → first synced order); `complete`; `dismissed`. PATCH `{ skip?: { courier?, costs? }, dismissed? }` |
| GET / PUT | `/products/variants/costs` | ✅ Owner/admin/ops/finance: variants with price and cost (`null` until entered), `?missingCost=true&limit&cursor`, counts; PUT `{ items: [{ variantId, cost: "250.50" }] }` (≤ 500, decimal strings, variant currency) → `{ updated, missingCost }`. Store syncs never overwrite a cost |
| GET | `/audit-log` | ✅ Who did what in this store, newest first (owner/admin). `?limit≤200&cursor=&action=member.` (exact or prefix) |

### Privacy (✅ E3-3)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/privacy-requests` | Owner/admin: requests for this store, newest first: `{ id, source, status, dueAt, completedAt, createdAt, hasExport }` |
| GET | `/privacy-requests/{id}/export` | Owner/admin: the compiled data of a `customers/data_request` (decrypted JSON); audited `privacy.export_downloaded`; `409` when the request has no export |

### Connections

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/connections` | ✅ Owner/admin/ops manager: `{ data: [{ id, kind, provider, account, status, reason, missingScopes, verifiedAt, updatedAt }] }`; a Shopify store missing a scope Mizan now needs reads `needs_attention` / `scopes_changed` (engine health stays in `/admin/integrations/health`) |
| GET | `/connections/shopify/install?shop=…` | ✅ Owner/admin: `{ authorizeUrl }` for the browser. `422 invalid_shop` unless `*.myshopify.com`; `503 shopify_not_configured` |
| GET | `/connections/shopify/entry` | ✅ Public, the app URL in the Partner Dashboard (App Store install, launch from Shopify admin): Shopify `hmac` verified → 302 to Shopify's authorize page |
| GET | `/connections/shopify/callback` | ✅ Public, the redirect URL: `hmac`, signed `state` (10 min, bound to the shop) verified, code exchanged, token kept sealed as a pending install → 302 to `WEB_URL/integrations/shopify/connect?install=…&shop=…`, or `?error=` `invalid_signature` · `invalid_shop` · `invalid_state` · `install_cancelled` · `shopify_unavailable` · `install_failed` · `scopes_missing` |
| POST | `/connections/shopify/claim` | ✅ Owner/admin: `{ install }` → `{ connection, reconnected }`. Errors: `install_not_found` (404, unknown or used), `install_expired` (410, 1 h), `install_not_yours` (403, started by another user or store), `shop_connected_elsewhere` (409), `store_limit_reached` (409, one Shopify store per account until E2-7) |
| POST | `/connections/bosta` | ✅ Owner/admin: `{ apiKey }` → connection `pending`; the key is stored encrypted with a generated webhook token and checked in the background (engine job `bosta.checkAccess`, a harmless authenticated delivery search): `active` + `connection.connected`, or `needs_attention` (`key_refused`, `key_lacks_permission`) + `connection.needs_attention`. Posting again replaces the key. `409 store_not_connected` before the store |
| POST | `/connections/{provider}` | Key-based connect for the next providers (EasyOrders, WooCommerce keys) |
| POST | `/connections/{id}/test` | Live credential check |
| DELETE | `/connections/{id}` | Disconnect, revoke webhooks, delete secret |

### Orders (M1) and verification (M2)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/orders` | ✅ E5-1. List, newest first. Query: `status`, `paymentMode`, `connectionId`, `from`, `to`, `q`, `limit` (≤ 100, default 50), `cursor`. `q` matches the order number (with or without `#`, prefix), the store's order id, or a phone in any form (keyed hash; names are not searchable). Returns `{ data, nextCursor, counts }`: rows show the customer as `{ label: "Mona A.", phoneLast4 }`, total, cash to collect, payment mode and status, risk; `counts` per status use the same filters except `status`. Agents see orders assigned to them, warehouse confirmed and shipped; media buyers are refused. Bad cursor → 422; `confirmation=needs_call` lists orders the team should call now, `needsCall` counts them (E6-10) |
| GET | `/orders/{id}/confirmation` | ✅ E6-7, E6-10. The order's confirmation run (with `calls: { attempts, max, after }`), its steps, attempts, the WhatsApp conversation (`whatsapp[]`: direction, kind, action, delivery status; never message text), the team's call `script` while open, and `channels { whatsapp, call_auto, call_team }`. Owner, admin, ops manager, agent (assigned) |
| POST | `/orders/{id}/confirmation/no-answer` | ✅ E6-10. The team called, nobody answered: `{ attempts, max, after, unreachable }`; the order leaves the call list until `after`; after the last try it stays, marked unreachable. 409 when not waiting for a call; audited |
| POST | `/orders/{id}/confirmation/link` | ✅ E6-7. `{ url, expiresAt, whatsappUrl }`: the customer's link and a wa.me link with the message, to send by hand; starts a manual run if none; audited; `no-store`, never replayed |
| POST | `/orders/{id}/confirmation` | ✅ E6-7. `{ answer: confirm\|cancel, reason?, note?, byCall? }` by the team (`byCall` counts it as a team call); 409 once answered; audited |
| GET / PUT | `/settings/confirmation` | ✅ E6-7, E6-10. `{ settings: { enabled, steps[{channel: whatsapp\|call_auto\|call_team, waitMinutes}] (team call last), callingHours{start,end}, teamCalls{attempts, retryMinutes}, linkHours }, channels }`. Owner, admin, ops manager |
| GET / PUT | `/settings/offers` | ✅ E6-11. `{ enabled, mode: rules_then_auto\|rules\|auto, maxDiscountPct, autoDiscountPct, inWhatsApp, inCalls }` (off by default; suggestion discount ≤ max). Owner, admin, ops manager; audited |
| GET / POST | `/offer-rules` | ✅ E6-11. List (active first); add `{ triggerVariantId \| null, offerVariantId, discountPct, priority, messageAr?, messageEn? }` (422 same product; 404 unknown product); audited |
| PATCH | `/offer-rules/{id}` | ✅ E6-11. `{ active }` stop or restart; 204 |
| GET | `/offer-products?q=` | ✅ E6-11. Active products to pick in a rule (title or SKU; 100 at most) |
| GET | `/offers/summary?days=30` | ✅ E6-11. `{ offered, accepted, declined, added[] }` (sales added per currency). Also finance |
| POST | `/orders/{id}/offer` | ✅ E6-11. `{ decision: accept\|decline }` on the team's call → `{ status }` (expired when too late; an answered offer keeps its answer); audited. The order's confirmation summary carries `offer` |
| POST | `/connections/whatsapp` | ✅ E6-10. Owner/admin: `{ phoneNumberId, wabaId, accessToken }` → connection `pending` (token encrypted); checked in the background: `active` when the token works and the store-language template is approved, else `needs_attention` (`token_refused`, `token_lacks_permission`, `template_pending`, `template_rejected`, `template_missing`). 409 `number_connected_elsewhere` |
| POST | `/connections/whatsapp/check` | ✅ E6-10. Check the number again (after Meta approves a template) |
| GET / POST | `/webhooks/whatsapp` (no `/v1`) | ✅ E6-10. Meta: GET answers the subscription check (`hub.verify_token` = `WHATSAPP_VERIFY_TOKEN`); POST carries messages and statuses for every connected number, `X-Hub-Signature-256` with `META_APP_SECRET` (401 otherwise), routed by the number's id, deduplicated by message id |
| GET / POST | `/public/confirm/{token}` | ✅ E6-7. No sign-in. GET: `{ store, state, firstName, order{number, items, total, cod, city}, hasLocation, expiresAt }`. POST `{ answer: confirm\|cancel\|change, reason?, note?, location? }` → the new state; 404 invalid, 409 already answered, 410 expired. IP rate limit, `no-store`, `X-Robots-Tag: noindex` |
| GET | `/orders/{id}` | ✅ E5-2. Order with lines, money (subtotal, shipping, discount, total, paid, refunded, still owed, cash to collect), payments ledger, shipments, timeline (newest first; `data` keeps source / changed fields / reason / payment from → to only), risk and reasons, delivery area. Customer masked as in the list (`label`, `phoneLast4`); `hasLocation`, `redacted`. Same role scope as the list: outside it → 404. P&L joins with E9 |
| POST | `/orders/{id}/reveal` | ✅ E5-2. `{ name, phone, address, location }` decrypted for this caller; each call writes `customer.pii_viewed` to the audit log (field names only). Owner, admin, ops manager, agent (assigned orders), warehouse (confirmed, shipped); not finance. 410 `pii_redacted` after a deletion request; 429 over 30 per minute per person; `Cache-Control: no-store`; `Idempotency-Key` is ignored (never stored or replayed) |
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
| GET | `/orders/{id}/pnl` | ✅ E9-2. One order's profit: `{ currency, day, isFinal, flags[], revenue, refunds, productCost, shipping, codFee, paymentFee, channelFee, ads, agent, packaging, returns, chargebacks, net, expectedRevenue, expectedNet }` (Money). Computed on first read. Owner, admin, finance, ops manager |
| POST | `/profit/recalculate` | ✅ E9-2. `{ from?, to? }` (store days) → `{ recomputed, truncated }`: provisional orders recomputed, 2,000 per call. Owner, admin, finance |
| GET | `/profit/summary?from&to` | Net profit, margin, components |
| GET | `/profit/breakdown?by=product\|store\|courier\|country\|day` | Grouped P&L |
| GET / POST | `/cost-rules` | ✅ E9-1. GET `?at=YYYY-MM-DD` (rules that apply that day, default today in store time) or `?history=true` (every version) → `{ baseCurrency, today, data }`. POST one rule (`kind` = `packaging_per_order` · `agent_per_order` {amount, scope.connectionId?} · `cod_fee_pct` {pct, scope.courier?} · `payment_fee_pct` {pct, fixed?, scope.method?} · `courier_rate` {amount, returnAmount?, scope.courier, scope.zone?} · `fixed_monthly` {amount, scope.label}; `validFrom` default today, 90 days back to 365 ahead) → 201 new version; the previous one for the same kind and scope ends the day before; same day = correction; 409 `later_version_exists`. Owner, admin, finance write; ops manager reads |
| DELETE | `/cost-rules/{id}` | ✅ E9-1. Stop: the rule applies through today; a version that has not started is withdrawn. 204 |
| GET | `/fx-rates?day=` | ✅ E9-1. `{ base, day, feed, rates[] }`: the store's base against USD and every currency its orders used in 90 days; each `{ quote, rate, source: manual\|feed\|same\|missing, day, stale }` |
| PUT | `/fx-rates/{day}/{quote}` | ✅ E9-1. `{ rate }` = 1 base → rate quote: the store's own rate for that day (wins over the feed). Today or earlier; audited |
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
| `POST /webhooks/shopify/gdpr` | ✅ Same HMAC; topics `customers/data_request`, `customers/redact`, `shop/redact` → `{ accepted, recorded }` (one request per store that held the shop; redeliveries record nothing). Set as the app's compliance URL |
| `POST /webhooks/bosta/{connectionId}?token=…` | Per-connection secret token (Bosta does not sign) |
| `POST /webhooks/whatsapp` | `X-Hub-Signature-256` with app secret; GET verify challenge |
| `POST /webhooks/payments/{provider}/{connectionId}` | Provider signature (e.g. Paymob HMAC, Stripe signature); re-read the transaction from the provider before acting |
| `POST /webhooks/marketplaces/{provider}/{connectionId}` | Provider signature or notification verification |

### Webhooks out (merchant integrations, V2)

Merchants subscribe to Mizan events (`order.confirmed`, `shipment.delivered` …). Deliveries are signed `X-Mizan-Signature: t=<ts>,v1=<hmac-sha256>`, retried with backoff for 24 h, visible in a delivery log.

### Admin / integration ops

✅ E2-5 — store-scoped (`X-Tenant-Id`), roles owner / admin / ops_manager; replays and city fixes are audited (`integration.*`); error texts pass the PII scrubber.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/integrations/health` | Connections, engine circuits and rate budgets, outbox counts, last dead letters, drift report, ✅ `backfill` (E3-5: `{ status: running \| done, phase, orders, products, pages, startedAt, finishedAt }` of the latest history import, or null); `{ connected: false, reason }` without a store connection |
| GET | `/admin/integrations/dead-letters` | Jobs needing a person (`?limit≤200`), newest first |
| POST | `/admin/integrations/jobs/{id}/replay` | Replay a dead-lettered job after a fix; `job_not_found` otherwise |
| POST | `/admin/integrations/cities/resolve` | `{ text, cityId, jobId? }`: teach a city alias (kept on the Bosta connection), replay the stuck job |

### Provider webhooks (✅ H-5)

Outside `/v1`, not in OpenAPI, no user auth: each provider's own verification.

| Method | Path | Verification |
| --- | --- | --- |
| POST | `/webhooks/shopify/{connectionId}` | Shopify HMAC (`SHOPIFY_API_SECRET`) over the raw body. ✅ `app/uninstalled` (E3-4): connection → `disconnected` (`status_reason: app_uninstalled`), credential deleted, its queued jobs dropped, `connection.disconnected` emitted, audited; orders and history stay; a reinstall reconnects the same connection |
| POST | `/webhooks/bosta/{connectionId}?token=…` | Per-connection token (Bosta webhooks are unsigned) |

Verify → dedupe → enqueue → 200 (thin webhook, fat fetch). Unknown connection → 404; disconnected → 200 `{ ignored }` so the provider stops retrying. Bodies up to `WEBHOOK_MAX_BODY_BYTES` (5 MiB).

## 3. OpenAPI

Generate the OpenAPI 3.1 document from NestJS decorators (`@nestjs/swagger`) and zod schemas in `packages/shared`. Publish at `/v1/openapi.json`; the web app generates its typed client from it.

**✅ E4-4 — the contract:**

- Every route declares its schemas with the decorators in `apps/api/src/platform/http/api-schema.ts`: `@ApiJsonBody(name, schema)` (the same zod schema `ZodPipe` validates), `@ApiJson(status, name, schema, description)` (response types are `z.infer` of that schema, so the handler cannot return another shape), `@ApiQueryZod(schema)`, `@ApiNoContent`, `@ApiProblems(...statuses)`. Every operation also gets a `default` problem response (`application/problem+json`, `ProblemDetails`).
- `apps/api/openapi.json` is committed. After changing a route or schema: `npm run openapi -w @mizan/api` (rewrites it) then `npm run gen:api -w @mizan/web` (rewrites `apps/web/src/lib/api/schema.d.ts`). Tests fail when either file is stale.
- `apps/api/test/openapi.e2e.test.ts` walks the platform routes and validates every real response against the schema documented for its status (problems against `ProblemDetails`), and checks that every operation has a typed success response and the request body it validates.
- Web side: `openapi-fetch` client (`apps/web/src/lib/api/client.ts`) adds the Firebase token, `Accept-Language`, `X-Tenant-Id` and an `Idempotency-Key` on POST; `ok()` turns problems into `ApiError(status, code, title)`. TanStack Query retries only network, 5xx, 429 and `token_expired` (after a forced token refresh), at most twice; failed actions toast the problem `title`, which the API already localises (Egyptian Arabic / English).
