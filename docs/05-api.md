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
| GET / PATCH | `/tenant` | Tenant settings (currency, timezone, locale). ✅ GET (any member); ✅ PATCH (A-8, owner/admin) `{ name?, timezone? (IANA), locale? (ar-XX \| en-XX) }`; country and currency never change (money, FX). Audited `tenant.updated` (only what changed; the name as `storeName`) |
| GET / POST | `/members` · `/members/invite` | ✅ Team (members + pending invitations); invite by email or phone `{ email \| phone, role }` → invitation with `acceptUrl` to share. Owner/admin; only owners invite owners. Re-inviting refreshes. `already_member` (409) |
| PATCH / DELETE | `/members/{userId}` | ✅ `{ role?, status?: active\|disabled }`, remove. Guards: `cannot_change_self`, owners only by owners, `last_owner`. Disabled members are locked out on their next request |
| DELETE | `/invitations/{id}` | ✅ Revoke a pending invitation (owner/admin) |
| POST | `/invitations/{id}/accept` | ✅ Signed in, no `X-Tenant-Id`. Only when the caller's **verified** email or OTP phone matches; otherwise `invitation_not_found` (also for revoked/accepted/expired; 7-day TTL). `GET /me` lists `invitations` addressed to the caller |
| GET / POST / DELETE | `/api-keys` | Manage API keys (owner/admin) |
| GET / PATCH | `/onboarding` | ✅ Owner/admin (E4-5): steps `store` (with the history import's progress and `missingScopes` to approve), `courier`, `costs`, `firstOrder`; `milestones` from product events; `timeToFirstValueS` (signup → first synced order); `complete`; `dismissed`. PATCH `{ skip?: { courier?, costs? }, dismissed? }` |
| GET / PUT | `/products/variants/costs` | ✅ Owner/admin/ops/finance: variants with price and cost (`null` until entered), `?missingCost=true&limit&cursor`, counts; PUT `{ items: [{ variantId, cost: "250.50" }] }` (≤ 500, decimal strings, variant currency) → `{ updated, missingCost }`. Store syncs never overwrite a cost |
| GET | `/audit-log` | ✅ Who did what in this store, newest first (owner/admin). `?limit≤200&cursor=&action=member.` (exact or prefix) |

### Back office (Mizan staff, E17)

`/platform/*` is for Mizan staff only (A-1): signed in, no `X-Tenant-Id`, **always** with a second factor (403 `mfa_required` before anything else), active staff (403 `not_staff`, `staff_disabled`), and the route's staff role (403 `insufficient_role`). Every call — refusals included, merchants probing the routes too — is a line in the staff trail (`platform_audit`: the route, never ids or query strings; outcome ok/denied/failed; status). The first super admin is created from `PLATFORM_BOOTSTRAP_EMAILS` (a verified email, with a second factor). Every change staff make to a store (A-2) is also written to **that store's** audit log (`GET /audit-log`) as `actor.type = "mizan_staff"` (`store.suspended`, `store.reactivated`, `store.plan_changed`, with before/after and the reason), so the merchant sees what Mizan did.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/platform/me` | ✅ A-1. `{ id, role, email }`: the caller as staff. Any staff role |
| GET / POST | `/platform/staff` | ✅ A-1. List; add `{ email, role: super_admin\|support\|finance\|engineer }` (a Mizan user who has signed in once: 404 `user_not_found`; 409 `already_staff`). Super admin |
| PATCH | `/platform/staff/{id}` | ✅ A-1. `{ role?, status?: active\|disabled }`; 409 `last_super_admin` (Mizan always keeps an active super admin). Super admin |
| GET | `/platform/stores` | ✅ A-2. `?q=<name, slug or id>&plan&status&country&createdFrom&createdTo&sort=newest\|orders&limit≤100&offset` → `{ data[{ id, name, slug, country, plan, status, createdAt, members, connections{ total, needsAttention }, lastMonth }], total, nextOffset }`. `lastMonth` is the last closed month's usage (the open month needs the store's own data). Deleted stores only with `status=deleted`. Any staff role |
| GET | `/platform/stores/{storeId}` | ✅ A-2. The store plus `team[]` (email, role, status), `integrations[]` (status, reason), `outbox{ pending, running, dead, oldestPendingAt }`, `deadLetters[]` (latest 20, scrubbed errors, no payloads), `usage[]` (closed months, up to 12), `notes[]`. Any staff role |
| POST | `/platform/stores/{storeId}/suspend` | ✅ A-2. `{ reason }` → `{ id, plan, status, updatedAt }`; members get 403 `tenant_inactive` at once (other API instances within the membership cache TTL); jobs and data are kept. 409 `already_suspended`, `store_deleted`. Super admin |
| POST | `/platform/stores/{storeId}/reactivate` | ✅ A-2. `{ reason? }` → active again; 409 `not_suspended`. Super admin |
| PUT | `/platform/stores/{storeId}/plan` | ✅ A-2. `{ plan, reason? }`; plan limits follow at once; the same plan changes nothing. Super admin, finance |
| POST | `/platform/stores/{storeId}/notes` | ✅ A-2. `{ body ≤ 2000 }` → 201 note; internal, the store never sees it. Any staff role |
| POST | `/platform/stores/{storeId}/access` | ✅ A-3. `{ reason, minutes: 5–480 (default 60), mode: read\|write }` → 201 `{ id, storeId, storeName, mode, reason, startedAt, expiresAt }`. Then call the store's own routes with its `X-Tenant-Id`: you act as an admin (owner-only routes stay closed), `GET`/`HEAD` only unless `write` (403 `support_read_only`), never team management or customer exports (403 `support_not_allowed`), a second factor always; every call is in the staff trail. 409 `access_open`. Super admin, support, engineer; `write` needs a super admin. Written to the store's audit log (`support.access_started`) |
| POST | `/platform/stores/{storeId}/access/end` | ✅ A-3. Ends your open access now → `{ ended }`; 404 when none |
| GET | `/platform/access` | ✅ A-3. Your open support access, soonest to end first |
| GET | `/platform/health` | ✅ A-4. `{ at, outbox{ pending, running, dead, oldestDueSeconds }, events{ pending, dead, oldestPendingSeconds }, deadEvents[{ type, count }], circuits[{ provider, open, halfOpen, closed }], stores[top 20 by dead then backlog], drift[{ connector, entity, kind, field, detail, count, stores, lastAt }], db{ pool, sizeBytes, connections }, process{ uptimeSeconds, rssBytes, heapUsedBytes } }`. Queue, event, circuit and pool numbers come from the code behind `/metrics` (the same values); circuits and drift cover the store engines built on the answering instance; no payloads or drift samples. Super admin, engineer |
| GET | `/platform/health/dead-letters` | ✅ A-4. `?storeId&kind&limit≤200` → dead-lettered engine jobs across stores, newest first `{ id, storeId, storeName, kind, provider, attempts, error (scrubbed), failedAt }`. Super admin, engineer |
| POST | `/platform/health/dead-letters/{id}/replay` | ✅ A-4. Queued again in its store → `{ replayed: true, storeId }`; 404 `job_not_found` unless dead; written to the store's audit log (`integration.job_replayed`, `mizan_staff`). Super admin, engineer |
| GET | `/platform/users` | ✅ A-5. `?q=<email, phone, name or id>&disabled=true\|false&limit≤100&offset` → `{ data[{ id, email, phone, name, createdAt, disabled{ at, reason }, stores, staffRole }], total, nextOffset }`. Super admin, support, engineer |
| GET | `/platform/users/{id}` | ✅ A-5. The person plus `memberships[{ storeId, storeName, storeStatus, role, status, joinedAt }]` |
| POST | `/platform/users/{id}/disable` | ✅ A-5. `{ reason }`: every request they make gets 403 `user_disabled` (this API instance at once, others within the user cache TTL); written to the audit log of each store they belong to (`user.sign_in_disabled`, `mizan_staff`). 409 `user_is_staff` (disable their staff access first), `not_yourself`. Super admin |
| POST | `/platform/users/{id}/enable` | ✅ A-5. They can sign in again (`user.sign_in_enabled` in their stores' logs). Super admin |
| GET | `/platform/flags` | ✅ A-6. Every flag `{ key, description, enabled (for everyone), stores[{ storeId, storeName, enabled }], updatedAt }`. Super admin, engineer, support |
| PUT / DELETE | `/platform/flags/{key}` | ✅ A-6. `{ enabled, description? }` creates or changes a flag for every store without its own setting; DELETE removes it (code reads it as off). Keys `a-z0-9_.`. Super admin, engineer |
| PUT / DELETE | `/platform/flags/{key}/stores/{storeId}` | ✅ A-6. `{ enabled }`: the store's own setting, which wins; DELETE clears it. 404 `flag_not_found`. Super admin, engineer |
| GET / POST | `/platform/announcements` | ✅ A-6. List (`?live=true`); post `{ level: info\|warning\|critical, titleAr, titleEn, bodyAr?, bodyEn?, link? (https), plans?, countries?, startsAt?, endsAt }`. Post: super admin, support |
| POST | `/platform/announcements/{id}/end` | ✅ A-6. Ends it now (kept for the record) |
| GET | `/platform/audit` | ✅ A-1. The staff trail newest first: `?limit≤200&before=<id>` → `{ data[{ id, staffId, email, action, outcome, status, target, storeId, at }], nextBefore }`. Super admin, engineer |

### Flags and announcements, store side (✅ A-6)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/flags` | Any member: `{ flags: { key: boolean } }`, every flag as it applies to this store (its own setting, else everyone's; unknown keys are off). apps/web: `useFlag(key)`; API modules: `FlagsService.isEnabled(tenantId, key)` (30 s cache) |
| GET | `/announcements` | Any member: live announcements for this store's plan and country, most serious first, both languages `{ id, level, titleAr, titleEn, bodyAr, bodyEn, link, endsAt }`. Shown across the dashboard; info and warnings can be hidden per device, critical ones cannot |

### Support access, store side (✅ A-3)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/support-access` | Any member: Mizan support open in this store right now `{ data[{ id, mode, reason, startedAt, expiresAt }] }` (the dashboard banner; never which staff member). History is in `/audit-log` |
| POST | `/support-access/{id}/end` | Owner/admin: ends it now → `{ ended: 1 }` (0 when it already ended); `support.access_ended` in the audit log |

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
| POST | `/connections/shopify/claim` | ✅ Owner/admin: `{ install }` → `{ connection, reconnected }`. Errors: `install_not_found` (404, unknown or used), `install_expired` (410, 1 h), `install_not_yours` (403, started by another user or store), `shop_connected_elsewhere` (409), `store_limit_reached` (409, more than `MAX_SHOPIFY_STORES` stores, default 3, until plan limits E12-1). ✅ E2-7: several stores per account, each syncing on its own |
| POST | `/connections/bosta` | ✅ Owner/admin: `{ apiKey }` → connection `pending`; the key is stored encrypted with a generated webhook token and checked in the background (engine job `bosta.checkAccess`, a harmless authenticated delivery search): `active` + `connection.connected`, or `needs_attention` (`key_refused`, `key_lacks_permission`) + `connection.needs_attention`. Posting again replaces the key. `409 store_not_connected` before the store |
| POST | `/connections/woocommerce` | ✅ E5-7. Owner/admin: `{ siteUrl (https; "shop.example.com" and a pasted …/wp-admin are tidied), consumerKey (ck_…), consumerSecret (cs_…) }` → store connection `pending` (`kind: store`, `account` = host and path). Keys stored encrypted with a webhook secret Mizan generates; in the same transaction the engine queues `woocommerce.syncWebhooks` (points `order.created/updated/deleted` at `/webhooks/woocommerce/{id}`, re-enables disabled ones — also the keys' check: `active`, or `needs_attention` `key_refused`/`key_lacks_permission`) and `woocommerce.backfill` (last 60 days, 50 per page). New keys for the same store keep the webhook secret and skip the history. 409 `store_connected_elsewhere`, 422 `site_not_https`/`invalid_site`; audited `connection.key_saved` (no keys) |
| POST | `/connections/woocommerce/authorize` | ✅ E5-7 one click. Owner/admin: `{ siteUrl, locale: ar\|en }` → `{ url, expiresAt }`: WooCommerce's approval page (`/wc-auth/v1/authorize`, `app_name=Mizan`, `scope=read_write`, `user_id` = a token signed by Mizan for this store, member and site, 30 min; `callback_url` `/webhooks/woocommerce-auth`; `return_url` Settings → Integrations `?woo=returned`). 422 for an HTTP site |
| POST | `/connections/{provider}` | Key-based connect for the next providers (EasyOrders, WooCommerce keys) |
| GET / PUT | `/connections/{id}/sync` | ✅ E7-7. Owner/admin: a Shopify store's write-back switches `{ progressEvents, markPaidOnDelivery, tagReturned, tagLost }` (all on by default; PUT takes any of them). Audited `connection.sync_updated`; the store's engine picks them up on its next job. 404 for other providers |
| POST | `/connections/{id}/test` | Live credential check |
| DELETE | `/connections/{id}` | Disconnect, revoke webhooks, delete secret |

### Orders (M1) and verification (M2)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/orders` | ✅ E5-1. List, newest first. Query: `status`, `paymentMode`, `connectionId`, `from`, `to`, `q`, `limit` (≤ 100, default 50), `cursor`. `q` matches the order number (with or without `#`, prefix), the store's order id, or a phone in any form (keyed hash; names are not searchable). Returns `{ data, nextCursor, counts }`: rows show the customer as `{ label: "Mona A.", phoneLast4 }`, total, cash to collect, payment mode and status, risk; `counts` per status use the same filters except `status`. Agents see orders assigned to them, warehouse confirmed and shipped; media buyers are refused. Bad cursor → 422; `confirmation=needs_call` lists orders the team should call now, `needsCall` counts them (E6-10); `stock=short` lists confirmed orders waiting for stock, `waitingStock` counts them, and each row carries `stock: reserved\|short\|untracked\|null` (E8-2); `shipping=ready` lists confirmed orders with no live shipment, not waiting for stock or a duplicate decision, `readyToShip` counts them (E7-2) |
| GET | `/orders/{id}/confirmation` | ✅ E6-7, E6-10. The order's confirmation run (with `calls: { attempts, max, after }`), its steps, attempts, the WhatsApp conversation (`whatsapp[]`: direction, kind, action, delivery status; never message text), the team's call `script` while open, and `channels { whatsapp, call_auto, call_team }`. Owner, admin, ops manager, agent (assigned); `optedOut`: the customer wrote STOP in the chat (E6-4b) |
| POST | `/orders/{id}/confirmation/no-answer` | ✅ E6-10. The team called, nobody answered: `{ attempts, max, after, unreachable }`; the order leaves the call list until `after`; after the last try it stays, marked unreachable. 409 when not waiting for a call; audited |
| POST | `/orders/{id}/confirmation/link` | ✅ E6-7. `{ url, expiresAt, whatsappUrl }`: the customer's link and a wa.me link with the message, to send by hand; starts a manual run if none; audited; `no-store`, never replayed |
| POST | `/orders/{id}/confirmation` | ✅ E6-7. `{ answer: confirm\|cancel, reason?, note?, byCall? }` by the team (`byCall` counts it as a team call); 409 once answered; audited |
| GET / PUT | `/settings/confirmation` | ✅ E6-7, E6-10. `{ settings: { enabled, steps[{channel: whatsapp\|call_auto\|call_team, waitMinutes}] (team call last), callingHours{start,end}, teamCalls{attempts, retryMinutes}, linkHours }, channels }`. Owner, admin, ops manager |
| GET / PUT | `/settings/offers` | ✅ E6-11, E6-12. `{ enabled, mode: rules_then_auto\|rules\|auto, maxDiscountPct, autoDiscountPct, inWhatsApp, inCalls, ai }` (off by default; suggestion discount ≤ max). Owner, admin, ops manager; audited |
| GET / POST | `/offer-rules` | ✅ E6-11. List (active first); add `{ triggerVariantId \| null, offerVariantId, discountPct, priority, messageAr?, messageEn? }` (422 same product; 404 unknown product); audited |
| PATCH | `/offer-rules/{id}` | ✅ E6-11. `{ active }` stop or restart; 204 |
| GET | `/offer-products?q=` | ✅ E6-11. Active products to pick in a rule (title or SKU; 100 at most) |
| GET | `/offers/summary?days=30` | ✅ E6-11. `{ offered, accepted, declined, added[] }` (sales added per currency). Also finance |
| GET | `/confirmation/summary?days=7\|30\|90` | ✅ E6-6. `{ days, orders, confirmed, cancelled, pending, rate, needsTeam, medianMinutes, byRoute[{route: auto\|bot\|agent\|hold, orders, confirmed, cancelled, pending, rate}], byChannel[{channel: auto\|whatsapp\|link\|call_team\|call_auto\|voice_ai\|agent\|store, confirmed, cancelled}] }`. Orders placed in the period that went through confirmation (routed or a run started; duplicates held or merged left out). `rate` = confirmed ÷ (confirmed + cancelled), one decimal, null before anything is decided; an order confirmed and later shipped, returned or cancelled counts as confirmed; `store` = decided outside confirmation (cancelled in Shopify). Counts only, no personal data. Owner, admin, ops manager |
| POST | `/orders/{id}/offer` | ✅ E6-11. `{ decision: accept\|decline }` on the team's call → `{ status }` (expired when too late; an answered offer keeps its answer); audited. The order's confirmation summary carries `offer`, with `status` (… `applying`, `applied`, `failed`) and `failure`: `not_in_store \| unavailable \| permission \| failed` (E6-13) |
| POST | `/connections/whatsapp` | ✅ E6-10. Owner/admin: `{ phoneNumberId, wabaId, accessToken }` → connection `pending` (token encrypted); checked in the background: `active` when the token works and the store-language template is approved, else `needs_attention` (`token_refused`, `token_lacks_permission`, `template_pending`, `template_rejected`, `template_missing`). 409 `number_connected_elsewhere` |
| POST | `/connections/whatsapp/check` | ✅ E6-10. Check the number again (after Meta approves a template) |
| GET / POST | `/webhooks/whatsapp` (no `/v1`) | ✅ E6-10. Meta: GET answers the subscription check (`hub.verify_token` = `WHATSAPP_VERIFY_TOKEN`); POST carries messages and statuses for every connected number, `X-Hub-Signature-256` with `META_APP_SECRET` (401 otherwise), routed by the number's id, deduplicated by message id |
| GET / POST | `/public/confirm/{token}` | ✅ E6-7. No sign-in. GET: `{ store, state, firstName, order{number, items, total, cod, city}, hasLocation, expiresAt }`. POST `{ answer: confirm\|cancel\|change, reason?, note?, location? }` → the new state; 404 invalid, 409 already answered, 410 expired. IP rate limit, `no-store`, `X-Robots-Tag: noindex` |
| GET | `/orders/{id}` | ✅ E5-2. Order with lines, money (subtotal, shipping, discount, total, paid, refunded, still owed, cash to collect), payments ledger, shipments, timeline (newest first; `data` keeps source / changed fields / reason / payment from → to only), risk and reasons, delivery area. Customer masked as in the list (`label`, `phoneLast4`); `hasLocation`, `redacted`. Same role scope as the list: outside it → 404. P&L joins with E9 |
| POST | `/orders/{id}/reveal` | ✅ E5-2. `{ name, phone, address, location }` decrypted for this caller; each call writes `customer.pii_viewed` to the audit log (field names only). Owner, admin, ops manager, agent (assigned orders), warehouse (confirmed, shipped); not finance. 410 `pii_redacted` after a deletion request; 429 over 30 per minute per person; `Cache-Control: no-store`; `Idempotency-Key` is ignored (never stored or replayed) |
| POST | `/orders` | ✅ E5-5. Manual order `{ source: phone\|whatsapp\|instagram\|facebook\|tiktok\|walk_in\|other, customer{name, phone}, address{line1, line2?, city, province?}, lines[{variantId \| title, quantity, unitPrice?}] (1–50), shipping, discount, payment{mode: cod\|prepaid\|partial\|bank_transfer, method?: wallet\|instapay\|card, paid?} }` → 201 `{ id, number: "M-1001", status }`. Projected like a store order (channel `manual`, no connection, tag `source:…`): personal data encrypted, catalogue lines linked to their variant, money already paid in the payments ledger, duplicates and risk checked, then confirmation. 422 `phone_invalid`, `unknown_product` (missing or archived), `currency_mismatch`, `total_invalid`, `paid_invalid` (a deposit between zero and the total; prepaid and a received transfer pay the total; COD takes none). Owner, admin, ops manager, agent (an agent's order is assigned to them); audited `order.created_manually`; safe to retry with `Idempotency-Key` |
| GET | `/orders/products?q=` | ✅ E5-5. Active products to add to a manual order (title or SKU, 100 at most). Owner, admin, ops manager, agent |
| PATCH | `/orders/{id}` | Edit address, items, notes (before shipping) |
| POST | `/orders/{id}/status` | `{ status, reason }` |
| POST | `/orders/bulk` | ✅ E5-4. `{ action: assign, orderIds, userId \| null }` \| `{ action: tag, orderIds, tags[] (≤ 5, added; in Shopify too) }` \| `{ action: confirm, orderIds }` \| `{ action: cancel, orderIds, reason: customer_cancelled\|duplicate\|out_of_stock\|fraud\|other }` \| `{ action: ship, orderIds }` (E7-2); 1–500 orders → 202 `BulkAction`. Applied by the worker in chunks of 25, each order in its own savepoint: done, skipped (`cancelled`, `unchanged`, `shipped`, `paid_needs_refund`, `already_confirmed`, `duplicate_suspected`, `not_found`; ship: `already_shipping`, `not_confirmed`, `address_missing`, `payment_blocks_shipping`, `store_not_connected`) or failed. Cancel also cancels the Shopify order (outbox job `shopify.cancelOrder`: read first, no refund, restocked, the customer not emailed; a timeout is verified, never re-sent), or the WooCommerce order (`woocommerce.cancelOrder`: read first, status set, the note added once); a paid order is skipped for a refund. Ship books the courier per order exactly as `POST /orders/{id}/ship` (one live shipment per order, `cashToCollect`); no API courier connected → 409 `no_courier` (`courier_needs_attention`) before anything is queued. 422 `not_assignable`, `unknown_orders`. Owner, admin, ops manager; the warehouse may ship only (other actions 403 `insufficient_role`) and follow progress; audited `orders.bulk_requested` |
| GET | `/orders/bulk/{id}` | ✅ E5-4. Progress `{ id, action, status: running\|done, total, done, skipped, failed, createdAt, finishedAt, issues[{ orderId, number, status, reason }] (200 at most) }` |
| POST | `/orders/{id}/duplicate` | ✅ E5-3. `{ action: keep \| merge }` → `{ status: kept \| merged }`: keep starts confirmation; merge cancels this order as a duplicate of the earlier one and tags it `mizan-duplicate` in Shopify. 409 `not_a_duplicate`, `not_mergeable` (shipped); an answered order keeps its answer. Owner, admin, ops manager, agent (own orders); audited. List: `?duplicate=suspected` and `duplicates` count; detail: `duplicate`, `duplicateOf { id, number, status, items, minutesApart }` |
| GET / PUT | `/settings/confirmation` → `script` | ✅ E6-5. `{ pack: egyptian\|formal, texts: { ar: {…}, en: {…} } }` with keys `confirmed`, `change_prompt`, `change_received`, `cancel_prompt`, `cancelled` (≤ 1,000 chars) and `call` (≤ 2,000, a line per line); variables `{{customer.first_name}}`, `{{order.number}}`, `{{order.total}}`, `{{order.cod}}`, `{{order.items}}`, `{{order.city}}`, `{{store.name}}` (an unknown one is 422; no address or phone). Empty keys keep the pack's wording; the WhatsApp template stays the approved one |
| POST | `/settings/confirmation/preview` | ✅ E6-5. `{ script, orderId? }` → `{ lang, sample, replies[{ branch: confirm\|change\|cancel, key, text }], call[] }`: the script filled from one of the store's orders or a sample. Owner, admin, ops manager |
| GET / PUT | `/settings/confirmation` → `routing` | ✅ E6-2. `{ enabled, autoMax, botMax, agentMax }` (0–100, rising; off by default): routes new orders by risk score |
| GET / PUT | `/settings/orders` | ✅ E5-3. `{ duplicateWindowHours }` 0–168 (48 by default; 0 turns detection off). Owner, admin, ops manager; audited |
| GET | `/confirmation/queue` | ✅ E6-3. `{ waiting, mine, later, nextAt, unreachable }`: orders whose confirmation waits for the team's call, counting the caller's own and nobody's (never another caller's). Owner, admin, ops manager, agent |
| POST | `/confirmation/queue/next` | ✅ E6-3. `{ order: { id, number, attempts, unreachable } \| null }`: claims the next order for the caller by assigning it to them (`order.assigned`); the caller's own first, retries due before new orders, the unreachable last; locked rows skipped, so two callers never get the same customer. Outcomes: `POST /orders/{id}/confirmation` (`byCall`) and `/confirmation/no-answer` (back at the retry time) |
| POST | `/orders/{id}/confirmations` | Log an attempt `{ channel, outcome, notes }` |
| POST | `/orders/{id}/whatsapp` | Send confirmation script now |

### Shipping (M3)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/orders/{id}/ship` | ✅ E7-1. No body. A confirmed order with a delivery address → `202` `Shipment { id, orderId, provider, booking: pending, status, trackingNumber: null, trackingUrl, cod, error, requestedAt, bookedAt }` and the outbox job `bosta.ship` (ids only; the worker reads the address and phone). While a booking is pending or booked, asking again returns it with `200` (never a second delivery). The courier's answer sets `booking` = `booked` (tracking number; the order becomes `shipped` with `shipped_at`; a Shopify order is fulfilled with the number) or `failed` with `error.code` `city_unknown`\|`address_invalid`\|`payment_blocks`\|`cancelled`\|`not_found`\|`courier_refused_key`\|`courier_failed` (ask again once fixed). `409`: `not_confirmed`, `address_missing`, `payment_blocks_shipping` (`errors[0].code` = the reason), `no_courier`, `courier_needs_attention`, `store_not_connected`. Owner, admin, ops manager, warehouse; audited `shipment.requested`. The order detail's `shipments[]` carries `booking`, `errorCode`, `trackingUrl` |
| GET | `/shipments` | ✅ E7-3. `view=active\|review\|delivered\|returned\|all` (default active; review = an unmapped status, a final one the courier contradicted, or a refused booking), `q` (tracking or order number), `limit`, `cursor` → `{ data[{ id, order{id, number, status}, provider, booking, status, statusRaw, statusAt, needsReview, errorCode, trackingNumber, trackingUrl, cod, area{city, province}, createdAt }], counts{…per view}, nextCursor }`. The area, never the address. Every role |
| POST | `/orders/{id}/ship/manual` | ✅ E7-6. `{ courier, trackingNumber }` → `201` `Shipment` (booked, status `created`). A courier without an API: the parcel handed over and recorded (the courier is kept as a `manual` courier connection by name, however it is typed); the order is shipped. `409`: `already_shipping`, `tracking_taken` (that courier's number is on another shipment), plus the ship checks (`not_confirmed`, `payment_blocks_shipping`). Owner, admin, ops manager, warehouse; audited `shipment.recorded` |
| POST | `/shipments/statuses/import` | ✅ E7-6. `{ csv }`: the courier's report — tracking number and status (a canonical key, or what couriers write: "تم التسليم", "مرتجع", "Out for delivery" …), `date` (YYYY-MM-DD or a time) and `note` optional; Arabic or English headers. → `{ rows, changed, unchanged, review }`. Each row is a person's update (source `ops`, the same rules as `/shipments/{id}/status`). All or nothing: `422 csv_invalid` with `errors[{ path: "line:N", code: header\|columns\|tracking\|status\|date\|duplicate\|too_many\|empty\|unknown_tracking\|not_booked, message }]`. Owner, admin, ops manager; audited `shipment.statuses_imported` |
| GET | `/shipments/{id}/events` | ✅ E7-3. The shipment's statuses newest first: `{ data[{ status, statusRaw, source: webhook\|poll\|ops, at, note }] }` |
| POST | `/shipments/{id}/status` | ✅ E7-3. `{ status, note? }` (any canonical status but `unknown`/`exception`) → `{ id, status }`. A person's override (rule 7): clears the review flag; delivered/returned move the order. Owner, admin, ops manager; `409 not_booked`; audited `shipment.status_set` |
| POST | `/shipments/{id}/cancel` | Cancel with courier |
| GET | `/shipments/{id}/label` | PDF label (A6/A4) |
| POST | `/pickups` | Request pickup |
| GET | `/couriers/scorecard` | ✅ E7-4. `days=30\|90\|180` (default 90; shipments booked in the period) → `{ days, couriers[{ courier, shipments, delivered, returned, inFlight, deliveredRate, rtoRate, avgDaysToDeliver, zones[{ zone, …same }] }] }`. Zone = the governorate, or the city when there is none. `deliveredRate` is the metric layer's formula (delivered ÷ ended); days booked → delivered. Days to remit wait for settlements (M8). Owner, admin, ops manager, finance |

### Warehouse (M4)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/products` | ✅ E8-1. Products by title with their variants `{ id, title, sku, barcode, barcodeOwner: store\|mizan, price, compareAt, cost (null until entered), available }` and the store they sync from (null = added in Mizan). `?search=` (title, SKU or barcode), `status=all\|active\|draft\|archived` (all = not archived), `missing=cost\|barcode`, `limit` ≤ 100, `cursor`; `counts { products, variants, missingCost, missingBarcode }`. Owner, admin, ops manager, finance |
| PATCH | `/products/variants/{id}` | ✅ E8-1. `{ cost?: "420.50", barcode?: "…" \| null }` (at least one). A barcode set here is Mizan's (store syncs leave it); `null` gives back the store's last barcode. 409 `barcode_taken` (names the SKU that has it). Audited `catalog.variant_updated`; a cost emits `costs.changed`. Title, price, SKU, status and stock are the store's and change there |
| POST | `/products/costs/import` | ✅ E8-1. `{ csv }`: header with SKU and cost and/or barcode (EN/AR names, Shopify's product export, Mizan's own download); other columns ignored; empty cells change nothing; a row with neither is skipped. All or nothing: 422 `csv_invalid` naming each line (`header`, `columns`, `sku`, `cost`, `barcode`, `duplicate`, `too_many`, `empty`, `unknown_sku`, `barcode_taken`). Barcodes may swap between SKUs in one file. → `{ costs, barcodes, skipped, missingCost }`; audited `catalog.costs_imported`; ≤ 5,000 rows |
| GET | `/stock` | ✅ E8-2. Variants by SKU in the main warehouse: `{ counted, onHand, reserved, available, storeAvailable, lowStockAt }` (null numbers until counted). `?search=` (title, SKU, barcode), `filter=all\|counted\|not_counted\|out\|low`, `limit` ≤ 100, `cursor`; `counts { variants, counted, out, low, waitingOrders }`, `warehouse`. Owner, admin, ops manager, warehouse, finance |
| POST | `/stock/movements` | ✅ E8-2. `{ items: [{ variantId, kind: receive\|count\|adjust, quantity, reason? }] (1–200), note? }`: receive > 0 adds; count ≥ 0 sets on hand (a first count starts counting the item in Mizan); adjust ≠ 0 needs `reason` (damaged, lost, found, correction, other). All or none: 422 `below_reserved` (on hand can't go under what confirmed orders hold), 404 unknown variant. → `{ applied, levels[], ordersReserved }`: more stock reserves waiting orders oldest first; a first count reserves confirmed orders already holding that item. Emits `stock.received` / `stock.adjusted`; audited `stock.recorded`; `Idempotency-Key` honoured. Owner, admin, ops manager, warehouse. Transfers come with several warehouses |
| PATCH | `/stock/{variantId}` | ✅ E8-5. `{ lowStockAt: n \| null }`: `stock.low` fires once when available falls to it or under (and `stock.out` at zero). 409 `not_counted` for an item not counted in Mizan. Audited `stock.threshold_set`. Owner, admin, ops manager, warehouse |
| GET / PUT | `/settings/inventory` | ✅ E8-5. `{ pushToStore }` (default false). On: each counted item's available count (on hand − reserved, never below 0) goes to the Shopify location that stocks it, on every change (`stock.changed` → outbox job `shopify.pushProduct`, compare-and-set with Shopify's idempotency key; the latest number always wins). Turning it on sends every counted item. Items not counted stay the store's. Audited `stock.settings_updated`. Owner, admin, ops manager |
| GET | `/stock/{variantId}/movements` | ✅ E8-2. The item's last 100 movements, newest first: `{ kind: receive\|count\|adjust\|reserve\|release\|pick…, delta, reason, note, order{id, number}? }`. Every level is the sum of these |
| POST | `/ops/sync` | ✅ E8-3. **Ops app batch sync**: `{ deviceId, ops: [{ opId (8–64, app-made), type, payload, at }] (1–200) }` → `{ serverTime, results[] }` in the order sent, each `{ opId, status: applied\|duplicate\|rejected\|conflict, original, code, message, result }`. Exactly once per store by `opId`: the first outcome is stored (`ops_operations`) and every replay returns it (`duplicate`, with `original`). Ops run in `at` order, each in its own savepoint. Types: `stock.receive`, `stock.count`, `stock.adjust` with `{ variantId \| barcode \| sku, quantity, reason?, note? }` (a scan sends the barcode). ✅ E10-3 `return.inspect` with `{ orderId \| orderNumber, items[{ lineId \| barcode \| sku, quantity, outcome }], note? }` (the line holding the scanned item). Codes: `unknown_type`, `invalid_payload`, `unknown_item`, `unknown_order` (rejected: never retried), `below_reserved`, `over_quantity`, `not_returned` (conflict: the server wins, the app tells the user). Ledger rows carry `device_op_id`. Audited `ops.synced`. Owner, admin, ops manager, warehouse |
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
| GET | `/profit/home?days=30` | ✅ E9-4. 7, 30 or 90 store days (today included), base currency: `yesterday`, `period { orders, revenue, net, expectedNet, fixedCosts, unallocatedAds, kept, expectedKept, margin, keptPer100, previousKept, change, delivered, returned, deliveryRate, refusalLoss, adSpend, breakdown }`, `cash { inTransit, awaitingRemittance }`, `trend[]`, `leaks[] { kind, count, amount }`. Owner, admin, finance, ops manager |
| GET | `/profit/breakdown?by=day\|product\|store\|courier\|country` | ✅ E9-5. `days` 7/30/90 (default 30) or `from`/`to` store days (≤ 366). `{ by, from, to, baseCurrency, rows[], total }`; each row `{ key, label, special, orders, delivered, returned, revenue, productCost, shippingAndCod, ads, returns, team, fees, net, expectedNet, margin }`. Base-currency orders by the day they were placed (like the home); courier = the order's latest shipment; by product an order is split exactly (product cost by line cost, the rest by line value). `special` keys: `manual`, `none`, `unknown`, `no_products`. Counts and money only. The web exports the same rows as CSV. Owner, admin, finance, ops manager |
| GET | `/ad-spend?from=&to=` | ✅ E9-3. `{ from, to, baseCurrency, total, unallocated, byPlatform[], days[] { day, connectionId, spend, orders, perOrder \| null, fxMissing }, data[] { day, platform, campaign, spend, source, connectionId } }`; default last 30 days, 92 at most. Owner, admin, finance, ops manager |
| PUT | `/ad-spend` | ✅ E9-3. `{ day, platform: meta\|tiktok\|google\|snapchat\|other, amount, currency?, connectionId? }`: the day's spend on that platform (replaces it). 422 `no_store`, `store_required` (several stores), future or > 400 days back; audited |
| DELETE | `/ad-spend/{day}/{platform}?connectionId=` | ✅ E9-3. 204; 404 when nothing was recorded |
| POST | `/ad-spend/import` | ✅ E9-3. `{ csv, platform?, connectionId? }` → `{ rows, days }`. All or nothing: 422 `csv_invalid` with `errors[] { path: "line:N", code: header\|day\|future\|too_old\|platform\|spend\|currency\|…, message: the value }`. 1 MB, 5,000 lines |
| PUT | `/fx-rates/{day}/{quote}` | ✅ E9-1. `{ rate }` = 1 base → rate quote: the store's own rate for that day (wins over the feed). Today or earlier; audited |
| GET | `/tickets` | ✅ E10-1. `?view=active (default)\|open\|waiting\|inspection\|resolved\|closed\|late\|all`, `type`, `orderId` (the order or the exchange it links), `mine=true`, `q` (T-1001, 1001, or the order's number), cursor pages of 50 → `{ data[{ id, number: "T-1001", type, reason, status, source, order{id, number, status}, assignee{id, name}, dueAt, late, createdAt, updatedAt }], counts{active, open, waiting, inspection, resolved, closed, late}, nextCursor }`, newest first. Agents see the tickets assigned to them, those they opened and the unassigned queue; owner, admin, ops manager, finance and warehouse see all |
| POST | `/tickets` | ✅ E10-1. `{ type: complaint\|exchange\|refund\|delivery_issue\|return\|refused, reason?: wrong_size\|wrong_item\|damaged\|missing_item\|not_as_described\|quality\|changed_mind\|late_delivery\|courier_behaviour\|not_delivered\|price\|other, orderId? \| orderNumber?, description? (≤ 2000), source?: team\|whatsapp\|phone\|courier, assignedTo? }` → 201 Ticket, numbered per store, due in 24 h; an agent's ticket is theirs (an agent assigns only to themselves). 409 `ticket_open` (one open case of a kind per order; `errors[0].message` is its id); 422 unknown order or member. Owner, admin, ops manager, finance, agent; audited `ticket.created`; event `ticket.created` |
| GET | `/tickets/{id}` | ✅ E10-1. The ticket with `description`, `createdBy`, `resolvedAt`, `closedAt`, `canEdit`, `assignees[{id, name, role}]` (who the caller may assign it to) and `history[{ type: created\|status\|assigned\|updated\|note, at, actor, data, note }]`, newest first. Outside the caller's scope → 404 |
| PATCH | `/tickets/{id}` | ✅ E10-1. `{ status?, type?, reason? (null clears), assignedTo? (null unassigns), note? }`: any working status to any other, resolved can be reopened, closed is final (409 `ticket_closed`; notes still allowed). Warehouse adds notes only (403 otherwise). Audited `ticket.updated`; events `ticket.status_changed`, `ticket.assigned` |
| GET | `/orders/{id}/returns` | ✅ E10-3. `{ orderId, eligible (returned, or delivered and sent back), canInspect, lines[{ lineId, title, sku, variantId, quantity, restock, damaged, writeOff, remaining }], inspections[] }`. Owner, admin, ops manager, finance, warehouse |
| POST | `/exchanges` | ✅ E10-2. `{ orderId, items[{ lineId, quantity }], lines[ same as a new order's ], shipping?, reason (ticket reasons), note?, ticketId? }` → `201` `Exchange { id, original, replacement{ id, number, status }, reason, status: awaiting_return\|returned, items, returnedValue, credit, toCollect, refundDue }`. Only a delivered order (409 `not_delivered`); never more units than the order has left to exchange (409 `over_quantity`). The replacement is a confirmed order numbered `{original}-X{n}` with the same customer and address (no confirmation run); what the customer paid for the returned items (the original's money in less refunds) moves as store credit (`refund` line on the original, `sale` line on the replacement), the difference is collected on delivery, a cheaper replacement leaves `refundDue`. `exchange.created`; `exchange.returned` once return inspection covers the items (earlier exchanges first). Owner, admin, ops manager, agent; audited `exchange.created` |
| POST | `/orders/{id}/partial-delivery` | ✅ E10-4. `{ kept[{ lineId, quantity }], collected?, note? }` → `{ orderId, status: delivered, due, collected, refundDue, kept[], comingBack[] }`. An order with the courier or just delivered; the customer owes for what they kept (+ shipping − discount); the courier's cash is a `cod_collection` line (default: what the kept items still owe; 409 `over_collected`); a deposit beyond it is a refund due; what comes back is inspected (E10-3). 409 `not_shipped`, `already_recorded`, `over_quantity`; 422 `nothing_returned` (kept everything). `order.partially_delivered`. Owner, admin, ops manager, warehouse; audited |
| POST | `/orders/{id}/refusal` | ✅ E10-4. `{ reason, openBox, note? }` → `{ orderId, reason, openBox, at }`: refused at the door (an order with the courier or returned), whether the customer opened the box first (المعاينة); a later call corrects it. `order.refused`. Owner, admin, ops manager, agent, warehouse; audited. The order detail has `partialDelivery` and `refusal` |
| GET | `/orders/{id}/exchanges` | ✅ E10-2. `{ outgoing[Exchange], exchangeOf: Exchange \| null }` |
| POST | `/orders/{id}/returns/inspect` | ✅ E10-3. `{ items[{ lineId, quantity, outcome: restock\|damaged\|write_off }] (1–100), note?, ticketId? }` → the state. Never past a line's quantity (409 `over_quantity`); only returned or delivered orders (409 `not_returned`). Event `return.inspected`: restocked units go back into stock (one `return_restock` movement per inspection, once), lost units count as product cost on the order's profit. Owner, admin, ops manager, warehouse; audited `return.inspected` |

### Automation (M13) and scripts (M14)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/automations/recipes` | ✅ E11-2. `?lang=ar\|en`: the built-in recipes (`modules/automations/recipes.ts`) with name, domain, trigger, conditions, steps and `installed` (the store's copy) |
| POST | `/automations/recipes/{key}/install` | ✅ E11-2. `{ language? }` (default: the store's): the recipe becomes the store's own automation, off until turned on; 409 `recipe_installed`, 404 unknown recipe |
| GET / POST | `/automations` | ✅ E11-1. `{ name, description?, trigger, conditions: { all \| any: [rule \| group] }, steps: [{ action, params }] (1–10), enabled }`; rules `{ field: event.data.… \| order.… \| item.…, op: eq\|ne\|gt\|gte\|lt\|lte\|in\|not_in\|contains\|exists\|not_exists, value }`, groups nested one level. Checked against `GET /catalog`: 422 `automation_invalid` naming each problem (`field_not_in_context`, `unknown_field`, `needs_order`, `invalid_params`). Owner, admin, ops manager; audited |
| GET / PUT / PATCH / DELETE | `/automations/{id}` | ✅ E11-1. GET: the automation, stats `{ runs, failures, lastRunAt }`, `pausedReason` and its last 50 runs `{ event, entityId, status: skipped\|succeeded\|failed, reason, version, depth, steps[] }`. PUT saves a new version (runs keep theirs; clears an error pause); PATCH `{ enabled }`; DELETE removes it and its runs |
| POST | `/automations/{id}/test` | ✅ E11-1. Dry run `{ eventId }` (a past event of its trigger) or `{ orderId }` (its trigger imagined for the order): `{ matched, rules: [{ field, op, value, actual, pass }], steps: [{ action, params (messages filled in), note }] }`. Nothing is done |
| GET / POST / PATCH | `/scripts` | Draft, edit blocks |
| POST | `/scripts/{id}/preview` | Render with a real order |
| POST | `/scripts/{id}/publish` | Version + submit WhatsApp templates if needed |

### Payments (M15)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/orders/{id}/payments` | ✅ E14-1. The order's ledger `{ orderId, currency, status, total, paid, refunded, chargedBack, net, balance, canRecord, lines[{ id, kind, method, status, source: store\|gateway\|courier\|manual, amount (signed), fee, feeIsActual, note, recordedBy, occurredAt }] }`, newest first. Owner, admin, ops manager, finance |
| POST | `/orders/{id}/payments` | ✅ E14-1. The team records money that moved outside any gateway: `{ type: received\|refunded, method: bank_transfer\|instapay\|wallet\|cash_pos\|store_credit, amount: "250.50" (Arabic digits accepted), note?, occurredAt? }` → 201 the ledger. The order's paid, refunded, status and cash to collect follow in the same transaction. 409 `over_payment` (more than still owed), `over_refund` (more than held); 422 `validation_failed`, `currency_mismatch`. Owner, admin, finance; audited `payment.recorded` (the note stays out of the audit log); safe to retry with `Idempotency-Key` |
| POST | `/orders/{id}/payment-links` | `{ purpose: full\|deposit\|balance\|convert_cod, amount?, discountPct? }` |
| GET | `/orders/{id}/refunds/options` | ✅ E14-4. `{ refundable (held less refunds still open), destinations[], approveOver }`. Owner, admin, ops manager, finance |
| POST | `/orders/{id}/refunds` | ✅ E14-4. `{ amount, destination: original_method\|store_credit\|bank_transfer\|cash, reason?, ticketId? }` → 201 Refund (R-1001…). Under the store's threshold approved at once (store credit then completes); over it (or in another currency) waits for approval. 409 `over_refund`; 422 `destination_unavailable` (original method only for money that came in online; store credit only with a customer), ticket not on the order. Owner, admin, ops manager, finance; audited `refund.requested` |
| GET | `/refunds` | ✅ E14-4. `?status=open (default: requested or approved)\|requested\|approved\|completed\|rejected\|failed\|all`, `orderId` → `{ data[Refund], counts }`. Each refund says what the caller `can` do and whether it `completesFromStore` |
| POST | `/refunds/{refundId}/approve` · `/reject` `{ reason }` · `/complete` `{ reference?, note? }` | ✅ E14-4. Owner, admin, finance. Approve: never by whoever asked (403 `own_refund`) unless the owner; re-checked against what the order holds. Complete: a transfer, cash, or the original method on Mizan's own orders → one refund line in the ledger; the original method on a store order → 409 `completes_from_store` (it completes when the store reports the refund). 409 `refund_not_pending` / `refund_not_approved`. Audited; events `refund.approved`, `refund.rejected`, `refund.completed` |
| GET / PUT | `/settings/refunds` | ✅ E14-4. `{ approveOver: "1000.00" }` in the base currency (default 1,000; 0 = every refund). PUT owner, admin; audited `refunds.settings_updated` |
| GET | `/payments` | ✅ E14-6. Orders by where their money stands: `?view=all\|unpaid\|paid\|cod_due\|refunds\|disputes`, `mode`, `q` (order number), cursor pages → `{ data[{ order{id, number, status, placedAt}, mode, status, methods[], total, paid, refunded, balance, cod }], counts (every view), totals[{ currency, total, paid, refunded, balance, cod }] (one row per currency), nextCursor }`. unpaid: any method but COD with nothing received (or failed), not cancelled; cod_due: cash the courier still collects before delivery; refunds: money given back; disputes: disputed or a chargeback booked. Owner, admin, ops manager, finance |
| GET | `/payments/mix` | ✅ E14-6. `?days=7\|30\|90` → `{ days, orders, modes[{ mode, orders, pct }], received[{ method, amount }] }`: the period's orders by payment mode (cancelled left out) and money in by method, net of voids, per currency. For the home screen |
| GET | `/disputes` | Lists and filters |
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
| GET | `/catalog` | ✅ E11-3. Automation triggers (every domain event except plumbing, with the context each loads: order, stock item or none), fields per context (no personal data), operators, actions with their params' JSON Schema, guards. One registry in code (`modules/automations/catalog.ts`) |
| GET / POST | `/notifications` · `/notifications/read` | ✅ E11-1. The caller's team notifications (addressed to roles; `notify.team` and alerts), newest first, with `unread`; `POST /notifications/read { ids } \| { all: true }` marks them read for the caller. Every member |

### Reports (M20)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/metrics/catalogue` | ✅ E15-1. The semantic metric catalogue the caller may see: `{ data[{ key, version, unit: count\|percent\|money\|days, module, name, definition }] }` in the reader's language. (Not `/metrics`: that path is Prometheus, outside the v1 prefix.) Every role, each seeing its own metrics |
| GET | `/metrics/values` | ✅ E15-1. `?keys=a,b` (default: all the caller may see), `days=7\|30\|90` (default 30, store days ending today) or `from`/`to` (≤ 366) → `{ from, to, currency, data[{ key, version, unit, value (decimal string; percent with one decimal; null when nothing to divide by), money?, numerator?, denominator? }] }`. Metrics a role may not see are left out, never zero; unknown keys 422 |
| GET | `/dashboards` | ✅ E15-2. Built-in dashboards the caller may see (at least one of its metrics): `{ data[{ id: home\|operations\|profit\|payments\|stock, name }] }` |
| GET | `/dashboards/{id}` | ✅ E15-2. `days=7\|30\|90` or `from`/`to` → `{ id, name, from, to, currency, tiles[{ key, name, definition, unit, value, money? }], series[{ key: orders\|net_profit, name, unit, points[{ day, value }] }] }`. Tiles are metric-layer values (the same as `/metrics/values`); tiles and series the caller may not see are left out; a dashboard with none is 404 |
| GET | `/dashboards/{id}/export` | ✅ E15-2. Same query plus `format=xlsx` (default) `\|csv` → the file as an attachment (`mizan-{id}-{from}-{to}.xlsx`), `Cache-Control: no-store`. Labels in the reader's language; xlsx right-to-left for Arabic; CSV is UTF-8 with BOM, formula-like cells defused |

### Billing (E12)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/usage` | ✅ E12-3. `?month=YYYY-MM` (this month by default, in the store's time zone) → `{ month, timezone, plan, closed, usage{ orders, whatsappMessages, aiOffers, stores, users }, limits{ ordersPerMonth, stores, users } (null = none), history[6]{ month, orders, whatsappMessages, aiOffers, closed } }`. Orders: placed in the month, every channel, cancelled ones too. Messages: WhatsApp sent (failed not counted). AI offers: offers Claude wrote. A month that is over is frozen (`usage_months`, closed hourly by the worker) and never changes. ✅ E12-1: also `alerts[{ metric: orders\|stores\|users, level: near (from 80%, all used included)\|over, used, limit }]`, `nextPlan{ plan, limits }`, `upgradeRequest{ plan, at }`. Owner, admin, finance |
| POST | `/usage/upgrade` | ✅ E12-1. `{ plan }` above the current one → 202 `{ plan, at }`; event `plan.upgrade_requested` for Brandita to follow up (payment with E12-2). Owner, admin; audited |

### Webhooks in (public, no user auth)

| Path | Verification |
| --- | --- |
| `POST /webhooks/shopify` | `X-Shopify-Hmac-SHA256` over raw body with app secret; dedupe `X-Shopify-Event-Id` |
| `POST /webhooks/shopify/gdpr` | ✅ Same HMAC; topics `customers/data_request`, `customers/redact`, `shop/redact` → `{ accepted, recorded }` (one request per store that held the shop; redeliveries record nothing). Set as the app's compliance URL |
| `POST /webhooks/bosta/{connectionId}?token=…` | Per-connection secret token (Bosta does not sign) |
| `POST /webhooks/woocommerce/{connectionId}` | `X-WC-Webhook-Signature` (base64 HMAC-SHA256 of the raw body with the connection's webhook secret); the unsigned save-time ping `webhook_id=N` gets 200 |
| `POST /webhooks/whatsapp` | `X-Hub-Signature-256` with app secret; GET verify challenge |
| `POST /webhooks/payments/{provider}/{connectionId}` | Provider signature (e.g. Paymob HMAC, Stripe signature); re-read the transaction from the provider before acting |
| `POST /webhooks/marketplaces/{provider}/{connectionId}` | Provider signature or notification verification |

### Webhooks out (merchant integrations, V2)

Merchants subscribe to Mizan events (`order.confirmed`, `shipment.delivered` …). Deliveries are signed `X-Mizan-Signature: t=<ts>,v1=<hmac-sha256>`, retried with backoff for 24 h, visible in a delivery log.

### Admin / integration ops

✅ E2-5 — store-scoped (`X-Tenant-Id`), roles owner / admin / ops_manager; replays and city fixes are audited (`integration.*`); error texts pass the PII scrubber.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/integrations/health` | Connections, engine circuits and rate budgets, outbox counts, last dead letters, drift report, ✅ `backfill` (E3-5: `{ status: running \| done, phase, orders, products, pages, startedAt, finishedAt }` of the latest history import, or null); `{ connected: false, reason }` without a store connection. ✅ E2-7: `?connectionId=` picks the store (default: the first) |
| GET | `/admin/integrations/dead-letters` | Jobs needing a person (`?limit≤200`), newest first, from every store (E2-7); replay and city fixes run in the job's own store |
| POST | `/admin/integrations/jobs/{id}/replay` | Replay a dead-lettered job after a fix; `job_not_found` otherwise |
| POST | `/admin/integrations/cities/resolve` | `{ text, cityId, jobId? }`: teach a city alias (kept on the Bosta connection), replay the stuck job |

### Provider webhooks (✅ H-5)

Outside `/v1`, not in OpenAPI, no user auth: each provider's own verification.

| Method | Path | Verification |
| --- | --- | --- |
| POST | `/webhooks/shopify/{connectionId}` | Shopify HMAC (`SHOPIFY_API_SECRET`) over the raw body. ✅ `app/uninstalled` (E3-4): connection → `disconnected` (`status_reason: app_uninstalled`), credential deleted, its queued jobs dropped, `connection.disconnected` emitted, audited; orders and history stay; a reinstall reconnects the same connection |
| POST | `/webhooks/bosta/{connectionId}?token=…` | Per-connection token (Bosta webhooks are unsigned) |
| POST | `/webhooks/woocommerce/{connectionId}` | ✅ E5-7. Signed by WooCommerce with the connection's secret; verify → dedupe on order id + `date_modified_gmt` → `woocommerce.ingestOrder` (re-read) → 200; the save-time ping answered 200; unknown connection 404, bad signature 401 |
| POST | `/webhooks/woocommerce-auth` | ✅ E5-7 one click. WooCommerce posts `{ key_id, user_id, consumer_key, consumer_secret, key_permissions }` after the owner approves; the signed `user_id` names the store and site (forged or expired → 401), Read/Write required (400), the member must still be an owner or admin (403); then saved exactly as `POST /connections/woocommerce` → 200 (WooCommerce needs 200) |

Verify → dedupe → enqueue → 200 (thin webhook, fat fetch). Unknown connection → 404; disconnected → 200 `{ ignored }` so the provider stops retrying. Bodies up to `WEBHOOK_MAX_BODY_BYTES` (5 MiB).

## 3. OpenAPI

Generate the OpenAPI 3.1 document from NestJS decorators (`@nestjs/swagger`) and zod schemas in `packages/shared`. Publish at `/v1/openapi.json`; the web app generates its typed client from it.

**✅ E4-4 — the contract:**

- Every route declares its schemas with the decorators in `apps/api/src/platform/http/api-schema.ts`: `@ApiJsonBody(name, schema)` (the same zod schema `ZodPipe` validates), `@ApiJson(status, name, schema, description)` (response types are `z.infer` of that schema, so the handler cannot return another shape), `@ApiQueryZod(schema)`, `@ApiNoContent`, `@ApiProblems(...statuses)`. Every operation also gets a `default` problem response (`application/problem+json`, `ProblemDetails`).
- `apps/api/openapi.json` is committed. After changing a route or schema: `npm run openapi -w @mizan/api` (rewrites it) then `npm run gen:api -w @mizan/web` (rewrites `apps/web/src/lib/api/schema.d.ts`). Tests fail when either file is stale.
- `apps/api/test/openapi.e2e.test.ts` walks the platform routes and validates every real response against the schema documented for its status (problems against `ProblemDetails`), and checks that every operation has a typed success response and the request body it validates.
- Web side: `openapi-fetch` client (`apps/web/src/lib/api/client.ts`) adds the Firebase token, `Accept-Language`, `X-Tenant-Id` and an `Idempotency-Key` on POST; `ok()` turns problems into `ApiError(status, code, title)`. TanStack Query retries only network, 5xx, 429 and `token_expired` (after a forced token refresh), at most twice; failed actions toast the problem `title`, which the API already localises (Egyptian Arabic / English).
