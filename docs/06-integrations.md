# 06 — Integrations and API access

How Mizan gets access to each outside system, what the engine already supports, and what to apply for first. Facts checked against official docs in October 2026; re-check before applying (sources at the end).

## 1. Four access routes

| Route | How | Lead time | Examples |
| --- | --- | --- | --- |
| 1 · Self-serve | Developer account, keys the same day, pay as you go | Days | Google Maps, Firebase, LLM provider, Snap CAPI token, Paymob sandbox, WooCommerce keys, EasyOrders key |
| 2 · Partner app + review | Mizan registered as an app; each merchant authorizes it; platform reviews | Weeks — **start in Discovery** | Shopify, Salla, Zid, YouCan, LightFunnels, Meta (WhatsApp, Ads), TikTok, Google Ads |
| 3 · Commercial contract | Business account + agreement, then credentials | Weeks | Bosta, J&T, Mylerz, Aramex, SMSA, SPL, Aymakan, Paymob live, Tabby, Tamara |
| 4 · Government, per merchant | Each merchant onboards Mizan on their own tax account | Per merchant | ZATCA Fatoora, Egypt ETA e-receipt, KSA National Address |

## 2. Engine status

| Connector | Status | Location |
| --- | --- | --- |
| Shopify (Admin GraphQL 2026-10) | ✅ Built and tested (orders with payment mode/status and received, outstanding, refunded amounts; products; inventory CAS; fulfil; courier progress as fulfillment events (E7-7); mark paid; tags; webhooks) | `packages/engine/src/connectors/shopify` |
| Bosta (v2) | ✅ Built and tested (duplicate-safe create collecting only what is owed, search, track, cancel, cities, learning status map) | `packages/engine/src/connectors/bosta` |
| FX daily rates | ✅ E9-1: `OpenErApiSource` (open.er-api.com, free, no key, latest only, USD base) behind `FxSource`; worker job once a day; **confirm the terms (attribution shown in Settings → Costs) and pick a licensed or central-bank source before production** | `apps/api/src/modules/profit/fx` |
| Payment rules for every courier | ✅ Built and tested (`cashToCollect`, exact money, hold unpaid orders) | `packages/engine/src/core/payments.ts` |
| Shopify OAuth install | ✅ E3-1: install / App Store entry / callback / claim, token exchange through `send()` (`exchangeShopifyCode`), fake OAuth in `FakeShopify`. **Expiring offline tokens** (Nov 2026: the Admin API answers a non-expiring token with 403 "Non-expiring access tokens are no longer accepted"): the code exchange sends `expiring=1`; the secret holds `{ accessToken, refreshToken, expiresAt, refreshExpiresAt }` (1 h / 90 days). `ShopifyTokens` refreshes 5 min before expiry or after a 401, under a lock on the connection row (each refresh rotates the refresh token, so two must never race), and writes the new pair with `secrets.renew` (not audited). A spent refresh token is `auth`: the merchant reconnects. A store connected before this holds a non-expiring token: on first use it is swapped for an expiring pair with Shopify's token exchange (`migrateShopifyToken`, `subject_token_type=…offline-access-token`, `expiring=1`), stored before use because Shopify kills the old token; if Shopify refuses the swap, the old token is kept and the store reconnects. Shopify's 403 "Non-expiring access tokens are no longer accepted" is classified `auth` (reconnect), not `permission`. A store marked as refusing Mizan (`key_refused`, `key_lacks_permission`) becomes active again when an import completes (`SyncResults`), announced as `connection.connected` with `recovered`, which re-registers its webhooks without a second import. The staging app uses Shopify-managed install (`use_legacy_install_flow = false`): with the legacy flow Shopify's own install link fails with `failed_grant_with_invalid_scopes` | `apps/api/src/modules/connections/shopify`, `apps/api/src/integrations/shopify-tokens.ts`, `packages/engine/src/connectors/shopify/oauth.ts` |
| Shopify webhook registration | ✅ E3-2: `connection.connected` → `shopify.syncWebhooks` engine job (converges subscriptions, safe to repeat) | `ShopifyConnector.syncWebhooks`, `apps/api/src/integrations/shopify-connected.consumer.ts` |
| Shopify compliance webhooks | ✅ E3-3: `/webhooks/shopify/gdpr` → `privacy_requests` → redact / compile (docs/07 §3) | `parseComplianceWebhook`, `apps/api/src/modules/privacy` |
| Shopify uninstall | ✅ E3-4: `app/uninstalled` → `ConnectionLifecycle.providerRevoked` (disconnect, delete token, drop queued jobs); `FakeShopify.uninstall()` revokes tokens (401) and drops subscriptions | `apps/api/src/integrations/connection-lifecycle.ts` |
| Shopify nightly reconciliation | ✅ E5-8: `shopify.reconcile` job per store day: `orders(query: "created_at:>='…' created_at:<'…'")`, 100 per page; orders the engine never recorded are ingested as if their webhook had come | `MizanEngine.shopifyReconcileJob`, `ShopifyConnector.ordersPage` |
| Shopify initial backfill | ✅ E3-5: on every connect, `shopify.backfill` job chain — orders created in the last 60 days, then all products, one page (50) per job, cursor in the next job (resumable), cost-limited; newest run wins on reconnect; progress in `/v1/admin/integrations/health` → `backfill` | `MizanEngine.shopifyBackfillJob`, `ShopifyConnector.ordersPage/productsPage` |
| WooCommerce (REST v3) | ✅ E5-7 engine: orders by signed webhook (fat fetch) and `modified_after` polling, payment detection for COD, bank transfer, cheque, online gateways and BNPL, EG state codes → governorates, webhook sync (create missing, re-enable disabled), Basic auth with the query-string fallback learned per connection; fake server + chaos suite (10/25/50 %). Platform ✅: `POST /v1/connections/woocommerce` (keys, checked by the webhook sync), `/webhooks/woocommerce/{connection}`, one engine per WooCommerce store (no Shopify needed), 60-day history, Settings → Integrations connect form; Bosta ships its orders (no store write-back yet); products with variations, barcodes (GTIN), prices and WooCommerce-managed stock (webhooks, history, poll). stock push (Mizan's count set where WooCommerce keeps it: the product, the variation, or the product for "parent" variations, summed). order cancel write-back (status `cancelled` set once, the team's note added once, WooCommerce restocks; completed or refunded orders are refused for a refund). ✅ P2 product edits: `PUT /products/{id}` with `name`, `description`, `status` (active → publish, draft → draft, archived → private), `tags` by id (WooCommerce drops a name alone: each is found with `GET /products/tags?search=` or created once with `POST /products/tags`, looked up again after a lost answer), `images` (the ids in the new order, then every other picture the store holds — WooCommerce keeps only those sent; the first is the main picture) and a simple product's prices; a variation's prices with `PUT /products/{id}/variations/{vid}`. A compare-at price above the price is a sale (`regular_price` = compare-at, `sale_price` = price), else `regular_price` and an empty `sale_price`. No vendor or product type in WooCommerce. ✅ P3 publishing: found first by `GET /products?slug=` (the handle, as for Shopify), else `POST /products` (simple: price, SKU, barcode; variable: `attributes` with `variation: true`), with `images [{ src }]` that WooCommerce downloads; then `POST /products/{id}/variations/batch` with only the variations it does not have. ✅ P4 product prices are in the store's currency, read from `GET /settings/general/woocommerce_currency` (kept a day; a 403 for keys without settings access falls back to Mizan's base currency). A WooCommerce `private` product reads as `archived` (and Mizan's archived is pushed as private), so an archive round-trips. A price changed in WordPress after Mizan set it is put back like Shopify's (`woocommerce.pushProduct` with both prices). ✅ O3 order edits: one `PUT /orders/{id}` with `line_items` (`{ id, quantity }`, 0 removes; `subtotal`/`total` for a new price; new items `{ product_id, variation_id? }`, a variation's parent read from `GET /products/{id}`), `shipping_lines` (the first set to the new fee, the others removed with `method_id: null`; none → a `flat_rate` line), `shipping` (address) and `meta_data` `mizan-edit-<id>`; a lost answer is checked by reading the order's meta, never sent twice; completed, cancelled, refunded or failed orders are refused. **Confirm on a real store** that quantity 0 removes a line and that totals are calculated again. ⏳ Tracking numbers back to the store (needs a shipment-tracking plugin) | `packages/engine/src/connectors/woocommerce`, `apps/api/src/modules/connections/woocommerce` |
| EasyOrders, LightFunnels | ⏳ MVP backlog | use `/new-connector` |
| J&T, Mylerz | ⏳ MVP / V2 | — |
| Claude (Anthropic Messages API) | ✅ E6-12 offer writer: raw HTTP through `send()` (breaker, bucket, error taxonomy: 429 `rate_limit_error` and 529 `overloaded_error` retried with `retry-after`, 401/403/402 stop, 400/404 ours), `anthropic-version: 2026-10-21`, structured JSON output, `fallbacks: "default"` (`server-side-fallback-2026-07-01`), low effort; refusals and cut-off answers fall back to Mizan's own offer; fake server + chaos tests. Key `ANTHROPIC_API_KEY` (Secret Manager), model `ANTHROPIC_MODEL` (default `claude-opus-5-5`) | `packages/engine/src/connectors/ai/claude.ts` |
| WhatsApp Cloud API | ✅ E6-4a connector: templates with quick replies, reply buttons, lists, text, template review status; Meta body-coded errors classified (`send()` `classify` hook); webhook signature, subscription challenge, messages and statuses parsed through the `Resolver`; fake Graph server + chaos suite (10/25/50 %). ⏳ Connecting a number (E6-4b) and the API webhook endpoint (E6-10) | `packages/engine/src/connectors/whatsapp` |
| Paymob (links, refunds, transactions) | 🚧 E14-2a built and tested: payment links through the Intention API (`POST /v1/intention/`, `Authorization: Token <secret key>`; amounts in the currency's minor units; one non-PII item; minimal billing data; `special_reference` `<order>:<purpose>:<attempt>`) and the Unified Checkout page per region (EG, KSA, UAE, OM); the 60-minute auth token from the API key for reads, renewed on 401; error classes (404 integration of the other mode → validation, never retried); a create is sent once per attempt — a lost answer makes the next attempt a new intention, the lost one never reaches anyone; engine job `paymob.createLink` with hooks `loadPaymentLink` / `onPaymentLink` (the phone and the checkout secret never go into a job or a log). Fake server + chaos (10/25/50 %). E14-2b: callbacks verified by HMAC over the 20 values (`hmac` in the query; TOKEN dropped), deduped on id + flag hash, the transaction re-read (a refund or void child through its parent), `transaction_inquiry` by reference when no callback comes; flags → state, once-only lines and cumulative totals through hook `onGatewayTransaction`, captures and refunds posted by `gatewayDeltaLines` against the ledger under a lock; unknown flags → review, no lines. ⏳ The API and screens (E14-2c), refunds (E14-2d), reports (E14-2e) | `packages/engine/src/connectors/paymob` |
| Meta / TikTok / Snap ads + CAPI | ⏳ V2 | — |
| Kashier, Fawry, Moyasar, Tap, HyperPay, Checkout.com, Stripe | ⏳ V2 (per market) | — |
| Noon, Amazon, Jumia | ⏳ V2 | — |
| Instagram / Messenger, email inbox | ⏳ V2 | — |
| Zoho Books, Odoo, Daftra | ⏳ V2 | — |
| Salla, Zid, SMSA, SPL, Aymakan, Tabby, Tamara, ZATCA | ⏳ V2 | — |

## 3. Storefronts

| Platform | Access | What you need | Review | Phase |
| --- | --- | --- | --- | --- |
| **Shopify** | Partner app with OAuth. Orders with customer name, phone or address need **protected customer data Level 2**, requested per field | Shopify Partner account, privacy policy, data protection details (encryption, access logs, incident policy) | Yes, for public apps | MVP |
| WooCommerce | Merchant approves via `/wc-auth/v1/authorize`, or creates Read/Write keys (Settings › Advanced › REST API) | Store on HTTPS; Mizan callback on HTTPS | None | MVP |
| EasyOrders | API key + authorized-app link; webhooks for order events | EasyOrders account; confirm partner terms | Confirm with EasyOrders | MVP |
| LightFunnels | OAuth 2 app; access token ~2 h, rotating refresh token | Developer app | Not stated | MVP |
| Salla | Partners Portal app; merchant OAuth; webhooks | Verified partner account, demo store | Yes | V2 |
| Zid | Partner Dashboard app; scopes justified one by one | Partner account, signed partnership agreement, tested dev store, a pricing plan | Yes | V2 |
| YouCan | Partner Dashboard app; seller OAuth with refresh tokens | Partner account | Not stated | V3 |

### WooCommerce specifics (handled by the engine, E5-7)

Read from WooCommerce's REST docs and source (`woocommerce/woocommerce` trunk: `class-wc-webhook.php`, `gateways/cod`, `gateways/bacs`, `class-wc-order.php`, `i18n/states.php`), October 2026.

- Base `https://{site}/wp-json/wc/v3`. HTTPS only; Basic auth with the consumer key and secret. Hosts that drop the `Authorization` header get the keys in the query string (tried once on a 401, then remembered in `connections.learned`).
- Errors `{ code, message, data.status }`: 401 keys refused (`auth`), 403 permission or a firewall page (`permission`), 404 `rest_no_route` = WooCommerce or the REST API off (`permanent`), `*_invalid_id` = `not_found`. No documented rate limit; 429/503 with `Retry-After` are honoured.
- Sites that print PHP notices before the JSON are read anyway (the JSON is recovered, drift recorded once); an HTML maintenance page on a 200 is retried.
- Orders: `date_*_gmt` carry no zone (read as UTC); line `price` is a number; `refunds[].total` are negative; the order `number` may differ from `id` (sequential-number plugins).
- **COD:** the core `cod` gateway puts the order in `processing` without payment, and `processing` stamps `date_paid`. For COD, Mizan never reads `date_paid` or the status as paid: the courier collects the total. `bacs`/`cheque` wait `on-hold` until the merchant moves them on; online gateways (`paymob`, `kashier`, `fawry_pay`…) are paid when `processing`/`completed` with `date_paid`; `on-hold` on an online gateway is unpaid (never "authorized"). A method WooCommerce does not name is `unknown` and does not ship.
- Webhooks: `X-WC-Webhook-Signature` = base64 HMAC-SHA256 of the raw body with the webhook secret (HTML entities decoded). Saving a webhook pings the URL with the unsigned body `webhook_id=N` and needs a 2xx. **No retries**, and after more than 5 failures in a row WooCommerce **disables** the webhook: the poll (`modified_after`, `dates_are_gmt`, oldest change first) covers the gap and `woocommerce.syncWebhooks` turns it back on. `X-WC-Webhook-Delivery-ID` is a hash of the webhook id and the current second, so it is not an event id: dedupe uses the order id and `date_modified_gmt`. `order.deleted` sends only `{ id }`; a deleted order reads 404 and becomes cancelled for Mizan.
- Products: a simple product is its own variant (order lines carry `product_id`); a variable product's variants are its variations (`variation_id`, read from `/products/{id}/variations`, 100 per page). `price` is the current price, `regular_price` the compare-at while on sale; `global_unique_id` is the barcode. Stock counts only when `manage_stock` is on; a variation with `manage_stock: "parent"` shares the product's `stock_quantity`. Product webhooks `product.created/updated` (deletions are not acted on, as for Shopify); the hourly webhook sync also adds topics a store is missing.
- Many Egyptian stores hide the shipping form: the billing block is then the delivery address. `shipping.phone` (WooCommerce ≥ 5.6) is usually empty; `billing.phone` is the checkout phone. EG `state` codes (`EGC`, `EGGZ`, `EGALX`…) become governorate names.
- One click ✅ (`class-wc-auth.php`): `/wc-auth/v1/authorize?app_name&scope=read_write&user_id&return_url&callback_url` (callback must be HTTPS); after approval WooCommerce POSTs `{ key_id, user_id, consumer_key, consumer_secret, key_permissions }` as JSON and needs exactly 200, then redirects to `return_url` with `success=1|0` and `user_id`. Mizan's `user_id` is a signed, 30-minute token (store, member, site).
- To confirm with a pilot store: deposit and partial-payment plugins (no core support; such orders read as their gateway), sequential-number plugins.

### Two-way sync: what reaches whom (Shopify ⇄ Mizan ⇄ courier)

Every write is an outbox job keyed so a step is never sent twice; webhooks are hints, the resource is read again (rules 3, 6). Store sync switches (Settings → Store sync) govern the courier steps, paid and tags.

| Happens in | Event | Mizan | Shopify (WooCommerce) | Courier (Bosta) |
| --- | --- | --- | --- | --- |
| Shopify | order created / updated / paid / refunded | order projected, ledger synced (webhook + 15-min poll + nightly reconcile) | — | — |
| Shopify | order cancelled | order cancelled | — | a booked delivery is flagged for the team to terminate |
| Shopify | order fulfilled with another courier | ✅ shipment recorded with that courier and tracking, order shipped, out of confirmation (`order.store_fulfilled`) | not sent back | — |
| Shopify | product created / updated | ✅ catalogue (created arrives by webhook now, not only the refresh) | — | — |
| Mizan | ✅ order typed by the team (manual) | order | created in the store once, named like Mizan's (M-1001), no emails; Mizan's id in a unique order metafield (`$app:mizan.order_id`) and `sourceIdentifier` `mizan:<id>`, so a retry adopts it and the copy coming back is linked, never imported; a second copy is cancelled. Then every row below reaches the copy (Settings → Store sync: "Create Mizan's orders in this store") | — |
| Mizan | confirmed / tagged / untagged | tags, timeline | tags | — |
| Mizan | cancelled (team, bulk, customer in confirmation, duplicate) | order cancelled | ✅ cancelled (any path; one the store cancelled is not sent back) | — |
| Mizan | edited before shipping | rebuilt | order edit (or refused, with the store's words) | — |
| Mizan | shipped with Bosta | shipment booked | fulfilled with tracking | delivery created (city + district) |
| Mizan | shipped with a courier without an API | shipment recorded | ✅ fulfilled with that courier and tracking | — |
| Courier | status (webhook or poll) | shipment and order move; unknown → review | fulfillment event; paid on delivery (COD); returned / lost tags | — |
| Mizan | status set by a person or a courier report (CSV) | shipment and order move | ✅ the same fulfillment event, paid and tags | — |
| Mizan | paid in full (link, transfer, cash in the ledger) | ledger | ✅ marked paid | — |
| Mizan | stock counted / changed | stock | available quantity (when "send our count" is on) | — |
| Mizan | product edited / created | catalogue | product updated / published | — |

**Recovery (sync guardian, every 2 minutes in the worker):**
- **Drops:** each store's engine polls what webhooks may have lost — Shopify / WooCommerce orders changed since its last look (overlap kept), every Bosta shipment still moving (45 days at most), and hourly the webhook subscriptions. The nightly store-day check (E5-8) stays as the last net for new orders.
- **Errors:** a job retries with backoff up to 12 times; one that died of trouble that passes (rate limits, timeouts, 5xx, an open circuit) is brought back 1 h, 6 h and 24 h after it died (`revivals`, capped at 3). Events whose consumers failed are brought back the same way. Refusals that need a person (validation, auth, permission, not found) are never retried blindly: they stay in Settings → Integrations with the provider's words and a Replay button.
- **Lost writes:** for the last 3 days, every write the store should have from Mizan's state (fulfillment with tracking, the courier's final step, paid on delivery, return / lost tag, cancel) is queued again under its usual key — a no-op when it was made, the missing step after a crash.
- **Stuck bookings:** a Bosta booking with no answer after 30 minutes and no job behind it is asked again; the engine looks the reference up first, so it is adopted, never booked twice.
- Anything recovered emits `sync.recovered` and is logged.

**Guarantees after the sync review (Nov 2026):**
- Every Bosta booking looks the reference up before creating, on every run (a revived or replayed job adopts the delivery Bosta has: one delivery per shipment).
- The guardian re-queues a stuck booking only when no job for it exists in any store's queue, and only in the store the booking uses.
- Money Mizan holds from its own sources that Shopify then shows (marked paid from Mizan) is not counted again (`ledger.syncStore`).
- The standalone engine's auto-ship on the `mizan-confirmed` tag is off in the platform: the courier is booked only through Mizan's shipping.
- A delivery is cancelled at Bosta (`POST /shipments/{id}/cancel`, terminate) and marked cancelled when Bosta confirms; a person cannot mark a Bosta delivery cancelled without it. Bosta refusing (picked up already) puts the shipment in review with why.
- To review, with why: an order cancelled in the store after booking, the cash to collect changing after booking, a parcel shipped both by Mizan and in the store. A fulfillment cancelled in Shopify cancels Mizan's record of it.
- An order made in Mizan and edited: its Shopify copy follows (quantities, catalogue items, delivery fee, address). Shopify cannot change a line's price or add an item outside the catalogue by an edit: refused, said on the order ("out of date in Shopify"), made in Shopify by the team. A refused copy is tried again after the order is edited.
- Not yet automatic: changing the COD or address of a delivery Bosta already has (Bosta's update API unconfirmed): flagged for a person.

Not synced, on purpose: refunds of money (Shopify would move real money; refunds are recorded in Mizan), and a delivery cancelled after booking (the team terminates it with the courier).

### Shopify specifics (already handled by the engine)

- API version pinned `2026-10`; Shopify versions quarterly. Fall-forward is detected from `X-Shopify-API-Version`.
- Cost-based rate limit (points/second by plan: 100 / 200 / 1,000 / 2,000; max single query cost 1,000). The limiter syncs to `extensions.cost.throttleStatus`.
- Webhooks: HMAC header `X-Shopify-Hmac-SHA256` (base64 HMAC-SHA256 of the raw body with the app's client secret); respond within 5 s; Shopify retries 8 times over 4 hours; dedupe on `X-Shopify-Event-Id`.
- `inventorySetQuantities` requires the `@idempotent(key:)` directive since 2026-04; the engine uses compare-and-set (`changeFromQuantity`).
- `productUpdate` cannot update variants → `productVariantsBulkUpdate` for price and compare-at price. ✅ P3 publishes a product made in Mizan: found first by its handle with `productByIdentifier(identifier: { handle })` (a direct read: the search index lags behind a create), else `productCreate(product: { …, handle, productOptions }, media: [{ originalSource: <Mizan's public picture URL>, mediaContentType: IMAGE }])`; then `productVariantsBulkCreate(…, strategy: REMOVE_STANDALONE_VARIANT)` replacing the one variant Shopify makes (on a retry, `DEFAULT` with only the missing combinations), or `productVariantsBulkUpdate` for a product without options. The handle is the title in Latin letters plus 8 characters of Mizan's id (`product-…` for an Arabic title), made once with the product. A product priced in another currency than `shop { currencyCode }` is refused. **Sales channels:** `productCreate` publishes to none, so an active product is then put on the Online Store: `publications(first: 50)` (the one whose catalog is "Online Store") and `publishablePublish(id, input: [{ publicationId }])`, safe to repeat. Needs `read_publications` and `write_publications` (in the app config since P3); a store that has not approved them yet answers ACCESS_DENIED, which is not an error: the product is made and the merchant picks its channels. ✅ P2 also sends `vendor` and `productType` with `productUpdate`, and the pictures' order with `productReorderMedia(id, moves)`: every picture moved to its place (moves apply in order, so the result is exactly that order; the first is the featured media). It runs as a background Job in Shopify; the next read shows it. `mediaUserErrors` are reported once as `validation`.
- Webhook subscriptions (✅ E3-2): on every connect the engine converges this app's subscriptions to `ORDERS_CREATE`, `ORDERS_UPDATED`, `ORDERS_CANCELLED`, `PRODUCTS_CREATE`, `PRODUCTS_UPDATE`, `APP_UNINSTALLED` → `PUBLIC_URL/webhooks/shopify/{connectionId}` (job `shopify.syncWebhooks`: list, delete ours that point elsewhere, create the missing ones; duplicates refused by Shopify are fine). Uses `uri` on `WebhookSubscriptionInput` (2025-04+); reading falls back to `endpoint.callbackUrl`. **Confirm on a dev store** that 2026-10 accepts `uri` on create.
- Order edits (✅ E6-13, accepted offers): `orderEditBegin(id)` → `orderEditAddVariant(id, variantId, quantity, allowDuplicates: false)` → `orderEditAddLineItemDiscount(id, lineItemId, discount: { percentValue, description })` → `orderEditCommit(id, notifyCustomer: false, staffNote)`; needs `write_order_edits`. The commit is not idempotent: the engine reads the order first (tag `mizan-offer-<id>` or a line with the variant), verifies a lost commit by reading again, and tags last. `userErrors` (sold out, cancelled order) are reported once as `validation`, never retried. **Confirm on a dev store** that 2026-10 keeps `calculatedOrder.addedLineItems` and `OrderEditAppliedDiscountInput.percentValue`, and whether the payment terms / COD outstanding follow the new total. ✅ O3 edits before shipping: `orderUpdate(input: { id, shippingAddress })` for the address (same values twice = no change), then one edit — `orderEditSetQuantity(…, restock: true)` (0 removes), `orderEditAddVariant`, `orderEditRemoveShippingLine` for every shipping line and `orderEditAddShippingLine` (2024-04+) for the new fee, `orderEditCommit(notifyCustomer: false)` — and the marker tag `mizan-edit-<id>` last. An order that already has the edit's quantities and fee is not edited again. Prices are not changed (an edit keeps the line's original price; Mizan reads `originalUnitPriceSet`). Order edits need protected customer data. **Confirm on a dev store** that a `CalculatedLineItem` carries its `LineItem`'s number (the engine falls back to the variant) and that `orderUpdate` keeps the name and phone when only the address lines are sent.
- **App Store requirement:** mandatory compliance webhooks `customers/data_request`, `customers/redact`, `shop/redact` (backlog E3).

- Courier progress (✅ E7-7): each new courier status becomes a `fulfillmentEventCreate` on the fulfillment carrying the tracking number — picked up `CARRIER_PICKED_UP`, in transit `IN_TRANSIT`, out for delivery `OUT_FOR_DELIVERY`, failed attempt `ATTEMPTED_DELIVERY`, delivered `DELIVERED`, exception `DELAYED`, returning (refused or undeliverable) and lost `FAILURE` with a message; `happenedAt` is the courier's time. Not idempotent in Shopify: the fulfillment's events are read first (same status and time, or any `DELIVERED`) and a timeout is verified by reading again. A version without `CARRIER_PICKED_UP` gets `IN_TRANSIT` (drift recorded). Per store (Settings → Store sync, `connections.config.sync`): events, mark paid on delivery (COD), tags `mizan-returned` and `mizan-lost`; all on by default. **Confirm on a dev store** that 2026-10 lists `CARRIER_PICKED_UP` in `FulfillmentEventStatus`.

Scopes: `read_orders` (+ `read_all_orders` for > 60 days), `write_orders` (mark paid, tags), `write_order_edits` (accepted offers join the order, E6-13), `read_products`, `write_products`, `read_inventory`, `write_inventory`, `read_merchant_managed_fulfillment_orders`, `write_merchant_managed_fulfillment_orders`, `read_customers`. A store installed before a scope was added shows `needs_attention` / `scopes_changed` with `missingScopes` (connections list and the onboarding store step) until the owner connects again and approves them in Shopify; scopes granted are kept in `connections.config.scopes`.

## 4. Couriers

| Courier | Market | Access | Phase |
| --- | --- | --- | --- |
| **Bosta** | Egypt | API key from a registered business account; staging and production | MVP |
| J&T Express | Egypt, KSA | No public portal found; request via merchant account manager | MVP |
| Mylerz | Egypt | API terms via commercial team | V2 |
| Aramex | Egypt, GCC | Five credentials (account number, username, password, PIN, entity); sandbox and production sets from sales rep | V2 |
| SMSA Express | KSA | Via account team | V2 |
| SPL (Saudi Post) | KSA | SPL team issues credentials; short-lived bearer tokens; customer + branch code on every call | V2 |
| Aymakan | KSA | Business account; official PHP SDK exists | V2 |

**Model:** each merchant connects their own courier account (their contract, their rates). Every courier adapter also accepts status and settlement files (CSV, Excel), so a missing API never blocks a merchant.

### Bosta specifics

- Base `https://app.bosta.co/api/v2`; header `Authorization: <raw key>` (no `Bearer`).
- `POST /deliveries?apiVersion=1` (create; type `SEND = 10`), `GET /deliveries/business/{trackingNumber}`, `PUT` same, `DELETE /deliveries/business/{tn}/terminate`, `POST /deliveries/search`, `POST /deliveries/bulk`, `GET /cities`, `GET /cities/{id}/zones`.
- No idempotency key on create → engine searches by `businessReference` before creating.
- Webhooks are not signed → per-connection secret token in the URL.
- **Confirmed on staging (Nov 2026):** `city` by name works ("Cairo"); a delivery must also name its district, or Bosta answers 400 "dropOffAddress must contain at least one of [districtId, districtName]". The connector reads `GET cities/{cityId}/districts` (zones of districts, cached a day), matches the area typed in any spelling (`matchDistrict`, with the shared list of areas), sends `districtId`, and falls back to `districtName` with the area as typed.
- **Confirm before production:** numeric state codes (Bosta's own SDKs disagree), `deliveries/search` body, `dropOffAddress` city field (`city` / `cityCode` / `cityId`), public tracking URL (default `https://bosta.co/tracking-shipments?shipment-number={tn}`, U26; `BOSTA_TRACKING_URL_TEMPLATE` overrides).
- **Store profile (U26):** the Admin API has no shop logo (`Shop.brand` is only in `unstable`). Mizan reads `shop { name myshopifyDomain currencyCode ianaTimezone billingAddress { countryCodeV2 } primaryDomain { url } }` with the Admin API, then the Storefront API (`POST https://{shop}/api/{version}/graphql.json`, header `X-Shopify-Storefront-Access-Token`) for `shop { brand { logo squareLogo colors } }`. The token is the app's own, titled "Mizan brand": `shop.storefrontAccessTokens` is read first and `storefrontAccessTokenCreate` runs once (one attempt; a lost answer is found by its title next time). Both need `unauthenticated_read_product_listings`; refused, the profile comes without the logo.
- **Order copies and addresses (U26):** `orderCreate` takes `customer: { toUpsert: { firstName, lastName?, phone?, email? } }` (Shopify matches an existing customer by phone or email) and `customAttributes`; `MailingAddressInput` (orderCreate and orderUpdate) has `provinceCode`, not `province`. Shopify reads a province back by its name ("Cairo").

## 5. WhatsApp Business Platform (Meta)

1. **Verify the business** (Brandita's Meta business portfolio). Unverified portfolios start capped at 2 phone numbers; verification raises it.
2. **Become a Tech Provider** so merchants connect their own numbers.
3. **Embedded Signup v4** inside Mizan (v2 deprecated from 15 Oct 2026).
4. Exchange code for the merchant's business token; subscribe webhooks; register the number with a 6-digit PIN.
5. Merchant adds a payment method in WhatsApp Manager; Meta bills them directly.
6. **Templates** need Meta approval before sending.

**Engine connector (E6-4a)** — `WhatsAppCloudConnector`, one per merchant number:

| Call | Endpoint | Notes |
| --- | --- | --- |
| Send | `POST /{version}/{phone-number-id}/messages` | `type` `template` (quick-reply payloads per button index), `interactive` (`button` ≤ 3 replies, titles ≤ 20; `list` ≤ 10 rows, titles ≤ 24, descriptions ≤ 72), `text`. Limits checked before sending. `biz_opaque_callback_data` = our step key |
| Templates | `GET /{version}/{waba-id}/message_templates?fields=name,status,language,category` | Paged by `paging.cursors.after`; status APPROVED / PENDING / REJECTED / PAUSED / DISABLED |
| Subscribe | `GET` webhook with `hub.mode`, `hub.verify_token`, `hub.challenge` | `verifyChallenge` |
| Deliveries | `POST` webhook, `X-Hub-Signature-256: sha256=<hex HMAC(app secret, raw body)>` | `verifyMetaSignature`, then `parseWhatsAppWebhook`: messages (`button` = template quick reply, `interactive.button_reply` / `list_reply`, `text`, `location`) and statuses (`sent`, `delivered`, `read`, `failed` + error code; others → `unknown` + drift) |

Quirks handled: errors come as HTTP 400 with a body code (130429 throughput and 131056 same customer within ~6 s are rate limits; 190 token → `auth`; 132001 template missing → `validation`; 131000/1/2 → retry); a free-form message outside the 24-hour window is accepted and fails later by webhook (131047); webhooks arrive batched, duplicated and out of order, sometimes before the send's response. **No idempotency key on sends:** a send whose response is lost is never re-sent blindly; the caller waits for a status webhook carrying its key and re-sends only if none arrives in 10 minutes (`afterUnknownSend`). Sends are not engine outbox jobs: they ride the confirmation step outbox in the API (E6-7/E6-10).

**Not confirmed (Meta's docs unreachable from the build environment; check before production):** the Graph version to pin (`v24.0` assumed, configurable); that every code above maps as listed (notably 131056's wait, 131047 only by webhook); that `biz_opaque_callback_data` is echoed on every status including `failed`; that numbers may be sent as digits without `+`; template list page size and fields; whether a template quick-reply tap always carries `button.payload` (fallback reads `button.text`).

**Pricing since 1 Jul 2025:** per delivered template message (marketing, utility, authentication; per country). Inside the 24-hour customer service window, replies are free and utility templates are free. → Design checkout with a click-to-WhatsApp button so the customer starts the chat and confirmation runs inside the free window.

## 6. Ad platforms (V2)

| API | Use | Access | Gate |
| --- | --- | --- | --- |
| Meta Marketing API | Spend by campaign / ad set / ad | `ads_read`; Advanced Access via App Review; full access tier needs 500+ calls in 15 days with < 15% errors | App Review, business verification |
| Meta Conversions API | Send confirmed and delivered events | Preferred: Meta Business Extension (allowlisted by a Meta rep). Fallback: merchant system-user token | Meta partner contact |
| TikTok Marketing + Events API | Spend + events | Developer app; advertiser OAuth; per-pixel tokens possible | App approval |
| Snap Marketing + Conversions API | Spend + events | CAPI: org admin generates token in Ads Manager; Marketing API: OAuth | Org admin |
| Google Ads API | Spend, offline conversions | Since 10 Sep 2026 access tied to a Google Cloud project; brand verification for Basic access | Cloud project, verification |

## 7. Payments, BNPL and banks

Full payment model: `docs/12-payments.md`. Payments always go to the **merchant's own** gateway, BNPL or bank account; Mizan never holds money and never sees card data (confirm licensing with counsel per country).

| Provider | Markets | Use | Phase |
| --- | --- | --- | --- |
| Paymob | EG, KSA, UAE, OM | Checkout payments, payment links, refunds, wallets, Apple Pay | MVP |
| Kashier, Fawry, Geidea | EG | Payments, reference payments (Fawry), links | V2 |
| Moyasar, HyperPay, Tap | KSA (Tap also GCC) | mada, Apple Pay, STC Pay, cards | V2 |
| Checkout.com, Stripe | UAE, KSA (Checkout.com) | Cards, Apple Pay | V2 |
| Tabby, Tamara | UAE, KSA | BNPL at checkout and as a payment link | V2 |
| valU, Sympl, Souhoola | EG | BNPL | V2 |
| InstaPay | EG | Open question: no public merchant API confirmed; match via bank statements (M8) | V2 |

For each provider confirm: authentication model, webhook signing, payment-link API, refunds API, transaction and payout reports (API or file), sandbox.

### Paymob in depth (E14-2, researched 3 Nov 2026)

Sources checked November 2026. **Postman** means Paymob's official collection, https://github.com/PaymobAccept/API-Postman-Collections. **Skill** means Paymob's own agent guide, https://github.com/PaymobAccept/Paymob-AI-Integration-Skill. **Docs** means pages under https://developers.paymob.com/paymob-docs/. The legacy site `docs.paymob.com` (and `docs.oman.paymob.com`) fails TLS, so anything that rests on it alone is in *Confirm before building*.

#### Accounts, hosts, credentials

- **Regional hosts** (Postman README; Docs `intention-apis/overview`): Egypt `https://accept.paymob.com`, KSA `https://ksa.paymob.com`, UAE `https://uae.paymob.com`, Oman `https://oman.paymob.com`. Every region uses the same paths. Test and live share a host; the mode comes only from the keys and integration IDs.
- There is no global account (Docs FAQ), so Mizan needs **one connection per merchant per region**.
- Paymob Payouts (disbursements, `payouts.paymobsolutions.com`, OAuth2 `/o/token/`, `expires_in` 3600) is a separate product. Its credentials are not acceptance credentials (Payouts docs).

Each connection stores (encrypted, through the secrets service): region, mode, Secret Key, Public Key, API Key, HMAC secret, and the integration ID of each enabled method.

| Credential | Where | Mode | Used for | Header |
| --- | --- | --- | --- | --- |
| Secret Key (`sk_live_…`) | Dashboard → Settings → API Keys | Per mode | Intention create, refund, void, capture | `Authorization: Token <secret_key>` (the literal word `Token`, not `Bearer`) — Docs `create-intention`; Postman refund/void/capture |
| Public Key (`pk_live_…`) | Same page | Per mode | Checkout URL only (client side), never sent on create | — |
| API Key | Same page (Postman says Settings → Account Info) | Same key in Test and Live (Docs `getting-integration-credentials`; Postman) | `POST /api/auth/tokens {"api_key"}` → `{token}`, which **expires after 60 min** (Postman, Transaction Inquiry) | `Authorization: Bearer <token>` for the inquiry calls |
| Integration IDs | Settings → Payment Integrations, per mode | Per mode | `payment_methods` on create | — |
| HMAC secret | Location not documented (see *Confirm*) | Probably per mode | Callback signatures | — |

- The engine caches the auth token per connection and refreshes it on 401 or before 60 min.
- Every method needs its own integration ID, enabled by the account manager (Docs overview).
- If an ID doesn't belong to the account, or its Live/Test mode doesn't match the key's, create returns **404 "Integration ID/Name does not exist"** (Docs `create-intention`, FAQ). Classify this as `validation` (configuration), never as retry.
- No rate limits or 429 behaviour are published for any Accept API (Postman; Skill says only "don't poll in a tight loop"). Use a conservative per-connection bucket in `send()`.

#### Creating a payment (Intention API)

`POST {host}/v1/intention/`, `Authorization: Token <secret_key>`, JSON body.

The path appears in Postman's Intention collection. The Docs page leaves both host and path blank ("POST /"), so check the path in sandbox (see *Confirm*).

| Field | Rule (Docs `create-intention` unless noted) |
| --- | --- |
| `amount` | Required, integer minor units. Get the factor from the currency's ISO decimals, never ×100 hard-coded (OMR ×1000 per a third-party integration; KWD/BHD 3 decimals is ISO 4217). `toMinor` already handles 3-decimal currencies. |
| `currency` | Required. Must match the integration IDs' currency. |
| `payment_methods` | Required. Integration IDs **as integers** (FAQ) or names (`"card"`). Same mode as the key. |
| `items` | Not marked required, but each item needs `name` and `amount` (otherwise 400). Mizan sends **one item**, `Order <number>`, with `amount` equal to the intention amount. This avoids product data and the unconfirmed rule on whether items must add up to `amount`. |
| `billing_data` | Optional as an object, but if present it needs `phone_number` (otherwise 400). Send the minimum (PII rule 12). Other required fields and the phone format are unconfirmed. |
| `special_reference` | Optional, "unique reference". Comes back as `order.merchant_order_id` in callbacks, and transactions can be looked up by it (FAQ). **Not a documented idempotency key.** Mizan sets `<order_id>:<purpose>:<attempt>` (`purpose` = `full`, `deposit` or `balance`). |
| `notification_url` | Server POST with the transaction on success or failure, for all methods, plus the card TOKEN callback. Postman: it **overrides** the integration ID's Transaction Processed URL. Mizan sets a per-connection URL carrying the connection's webhook token. |
| `redirection_url` | Customer redirect with query params, Card and Wallet only. Postman: it overrides the Response URL for card/wallet; other methods use the integration's URL. |
| `extras` | Custom fields, returned under `payment_key_claims`. Put only Mizan IDs here, no PII. |
| `expiration` | Optional number; no unit or default documented (see *Confirm*). |
| `is_auth` | Authorize only: `is_auth: true` (Skill), or on some accounts `payment_type: "AUTH"`. Auth/Capture must be enabled on the account. Default in Mizan: off (sale). |

**Response** is `201` with `id` (intention), `intention_order_id` (the Paymob order ID seen in callbacks; this is inferred, because the sample shows it equal to `payment_keys[].order_id`), `client_secret`, `payment_keys`, `payment_methods`, `special_reference`, `extras`, `confirmed`, `status`, `created`. Store `id`, `intention_order_id` and `special_reference`. `client_secret` is a credential for this intention: store it encrypted and never log it.

**Full, deposit, balance.** Paymob has no partial-payment or deposit feature on intentions or links (Docs; QuickLink page). Each amount is its own intention:

- `full` = what the courier would collect (`cashToCollect`) or the order total for prepaid.
- `deposit` = the offer's deposit (E14-3 default 30%).
- `balance` = `orders.balance_minor` at the time of creation.

Paying one never pays another. Before creating a balance intention, Mizan re-reads the order's balance.

**Hosted checkout** (Unified Checkout, Docs `unified-checkout-redirection`): `https://{eg|uae|ksa|om}.checkout.paymob.com/?publicKey=<pk>&clientSecret=<client_secret>`. There is no sandbox host; test keys go in the same URL. Paymob recommends this over the legacy iFrame, and a new iFrame needs support. Card data stays on Paymob's page (rule 13). This URL is the "payment link" Mizan sends by WhatsApp.

**QuickLink API (alternative links)** (Docs `create-quicklink`):

- `POST` (official path blank; a third party uses `/api/ecommerce/payment-links`, multipart) with `Authorization: Bearer <auth token>`.
- All body fields are typed as strings: `amount_cents`, `payment_methods`, `expires_at` (must be in the future), `reference_id`, `is_live`, `full_name`, `email`, `phone_number`, `notification_url`, and others.
- Response `200` with `id`, `client_url`, `shorten_url`, `state`, `paid_at`, `order`, `reference_id`, `expires_at`.
- Errors: 400 "Reference ID already exists.", 400 for a past `expires_at`, 401, and 404 when `is_live` doesn't match the integration.
- `email` and `phone_number` make **Paymob email or SMS the customer**. Mizan never sends them (PII, and a link from a retried create must not reach the customer).
- The dashboard can cancel unpaid links (Docs `no-code/payment-links`). The cancel endpoint is third-party only.
- Use QuickLink only if the intention's `client_secret` turns out to be too short-lived for a 24 h offer (see *Confirm*).

#### Callbacks

Two callbacks (Docs `manage-callback/transaction-callbacks`, `integration-paths/apis`):

- **Processed** callback: a server POST with a JSON body. It is the source of truth.
- **Response** callback: a browser GET with flat query params. Paymob says never to update the order from it, because the customer may not complete the redirect.
- Verify every callback by HMAC before trusting it.
- There are no event names. Every transaction callback has `type: "TRANSACTION"`. A saved-card callback is a separate POST to the same URL with `type: "TOKEN"`. Branch on `type`.

**POST body:** `{ type, obj, issuer_bank, transaction_processed_callback_responses }`. `obj` has:

- identifiers and amounts: `id`, `amount_cents`, `currency`, `integration_id`, `profile_id`, `owner`, `created_at`, `updated_at`
- status flags: `pending`, `success`, `error_occured`, `is_auth`, `is_capture`, `is_captured`, `captured_amount`, `is_voided`, `is_refunded`, `refunded_amount_cents`, `parent_transaction`
- nested objects: `order {id, merchant_order_id}`, `source_data {type, pan, sub_type}`, `data {message, txn_response_code, acq_response_code, card_type}`
- other: `payment_key_claims`, `is_hidden`

The reference table on that page wrongly calls `type` a unique transaction ID.

**Transaction HMAC** (Docs `hmac-transaction-callback`):

1. Take the values of these 20 keys in this exact order: `amount_cents, created_at, currency, error_occured, has_parent_transaction, id, integration_id, is_3d_secure, is_auth, is_capture, is_refunded, is_standalone_payment, is_voided, order.id, owner, pending, source_data.pan, source_data.sub_type, source_data.type, success`.
2. Join them with no separator.
3. Compute HMAC-SHA512 with the connection's HMAC secret.
4. Compare in constant time against `?hmac=` in the **query string**. It is not in the body or a header.

Details:

- Booleans render as lowercase `true`/`false`.
- For the POST, the values come from `obj` (`obj.order.id`, `obj.source_data.*`). For the GET, the order field is `order_id` per the HMAC page, but the sample URL shows `order=`.
- Output is lowercase hex (inferred from the sample).
- **Unit-test vector** (official): `amount_cents=100000, created_at=2024-06-13T11:33:44.592345, currency=EGP, error_occured=false, has_parent_transaction=false, id=192036465, integration_id=4097558, is_3d_secure=true, is_auth=false, is_capture=false, is_refunded=false, is_standalone_payment=true, is_voided=false, order.id=217503754, owner=302852, pending=false, source_data.pan=2346, source_data.sub_type=MasterCard, source_data.type=card, success=true` → `fa8ac0b7f3852e60c50e7fdd4ea5ef0bda96030c19dea1d55df8c76d6c08ab1877774662cbb04981dc84839ad4da560bcc8cb53b8973548657f7e8f8d2e79930`.

**TOKEN HMAC** (Docs `hmac-for-card-tokens`): HMAC-SHA512 over `card_subtype, created_at, email, id, masked_pan, merchant_id, order_id, token`, in that order. Mizan does not store card tokens. It verifies the callback, acknowledges it and drops it.

**Delivery:**

- Paymob documents no retry schedule, timeout, required status code, resend, or source IPs (Docs `webhook-callbacks-and-hmac`). Hookdeck's guide says the same outcome "can arrive more than once".
- The docs disagree on when callbacks fire. The overview says only on success or decline. The transaction-callbacks page says "after any action on the payment", and the testing tool covers refund, void and capture. **Assume pending callbacks may never come, and poll.**
- Handler: verify HMAC → dedupe on `obj.id` + a hash of the status flags (the same `id` recurs after refund, void or capture; this key is a Mizan design) → enqueue → 200. The worker then **re-reads** the transaction (rule 6).
- Test with the Webhook Testing Tool `hooks.paymob.com` (temporary endpoint per integration ID). Capture real payloads for each method there, for the fake server's fixtures.

#### Re-reading

Auth for both calls is `Bearer <auth token>` (Postman, Transaction Inquiry).

| Call | Use |
| --- | --- |
| `GET {host}/api/acceptance/transactions/{transaction_id}` | Full transaction: the flags above plus `is_settled`, `is_live`, `refunded_amount_cents` (cumulative across partial refunds), `captured_amount`, `parent_transaction`, `order{…, paid_amount_cents, commission_fees}`, `merchant_commission`, `paid_at`. In card `data.*`, amounts are in **major** units (`data.captured_amount: 20` next to `amount_cents: 2000`), and `data.migs_transaction.acquirer.settlementDate`/`batch` are present. Never read money from `data.*`. |
| `POST {host}/api/ecommerce/orders/transaction_inquiry` `{order_id}` or `{merchant_order_id}` | Returns **only the most recent** transaction of the order. The Docs page puts `auth_token` in the body; Postman uses the Bearer header. Send both. This is the fallback when no callback arrived: inquire by `special_reference`. |

#### States → Mizan

The outcome comes from the booleans (Docs `transaction-callbacks`). Mizan acts on the **re-read** transaction, never on the callback body. Money lines come from the parent's cumulative fields, the same way as the Shopify running totals (docs/12 §3). That way it doesn't matter whether Paymob sends child callbacks, or which transaction they carry. A child transaction (`has_parent_transaction=true`) only triggers a re-read of its parent.

| Paymob (re-read) | `payment_status` effect | Ledger line (`LedgerService.post`) | `external_ref` |
| --- | --- | --- | --- |
| `pending=true` (3DS, kiosk reference made, cash awaiting collection) | Unchanged (`unpaid`); kiosk reference shown | None | — |
| `success=false, pending=false` | Attempt failed; `payment.failed` | None | — |
| `success=true, pending=false, is_auth=false` | Paid or partially paid | `sale` +`amount_cents` | `<txn id>:sale` |
| `success=true, is_auth=true` | `authorized`; never treated as paid (Skill) | `authorization` +`amount_cents` | `<txn id>:auth` |
| `captured_amount` rises | Paid | `capture` + the increase over what the ledger holds | `<txn id>:capture:<new total>` |
| `is_voided=true` | `voided` | `void` − the amount held | `<txn id>:void` |
| `refunded_amount_cents` rises | `partially_refunded` / `refunded` | `refund` − the increase over what the ledger holds | `<txn id>:refund:<new total>` |

- **Built (E14-2b):** the engine hands the platform the state, the once-only lines (sale, authorization, void; fixed references) and the cumulative `totals` (captured, refunded, and when the change was made). The platform posts captures and refunds with `gatewayDeltaLines(update, held)`, where `held` is what the ledger already holds for that transaction, in the same database transaction with that payment's rows locked. The ledger is the record: a snapshot kept beside it could go stale between a retry and a second worker and post a refund twice (review of E14-2b).
- Only documented rows map; `success` and `pending` together, a success with `error_occured`, a child whose parent id cannot be read, or a refund on a capture that the authorization's totals do not show are `unknown` / review, with no lines. The walk goes up to the root payment (a refund of a capture is two levels up). Capture, refund and void lines are each dated by their own child transaction in the chain, else when Mizan saw the change; several refunds found at once are one line on the later date. Captures come only from authorizations (a sale's own `captured_amount` never makes a second line), and a failed or pending payment that shows money refunded, captured or voided goes to review.
- Callbacks dedupe on the transaction id plus a hash of **signed** fields only; `refunded_amount_cents` and `captured_amount` are not signed, so they cannot mint new jobs from one valid HMAC.
- A refund increase that matches an approved Mizan refund (E14-4) completes that refund. Otherwise it is a refund made **in the Paymob dashboard** (refunds, voids and captures can all be done there; Docs `manage-payment-apis/*`). Post it as an outside refund, never ignore it.
- There is no chargeback API, and disputes go through Paymob support (Skill). They stay team-recorded (E14-5). Paymob advises asking it before refunding a disputed transaction, because a refund plus a lost dispute debits the merchant twice. Mizan blocks a gateway refund on an order with an open dispute.

#### Refund, void, capture

All three use `Authorization: Token <secret_key>` with a JSON body (Postman *Refund & Void & Capture*). None has an idempotency key, and none has a documented response or error shape: no saved responses exist.

| Call | Body | Rules |
| --- | --- | --- |
| `POST /api/acceptance/void_refund/refund` | `{transaction_id: int, amount_cents: int}` | Full or partial. ≤ the original amount, repeatable until fully refunded (Postman; Docs `refund`). Returns to the same method; timing varies by method and bank. **No refund for Kiosk.** Transaction fees apply to the refund. |
| `POST /api/acceptance/void_refund/void` | `{transaction_id: int}` | Full amount (no amount field). **Card payments only** (Docs `void`): Apple Pay and Google Pay can be voided; wallets, StcPay, BNPL, installments and kiosk cannot (Skill). Same business day, before settlement; no fee. The cutoff time is undocumented. |
| `POST /api/acceptance/capture` | `{transaction_id: int, amount_cents: int}` | Full or partial, ≤ the authorized amount. Card Auth transactions only. **Auto-voided if not captured within 14 days** (Postman). |

Per method (Skill tables, "checked 2026-10"; the Skill says support can vary by account):

- **BNPL:** Tamara, Premium and Seven refund **in full only**. valU, Souhoola, Forsa, Aman, Sympl, Halan, Klivvr, Contact, MOGO, TRU, Mylo and Tabby refund in full or in part.
- **Egyptian wallets and StcPay:** refund, no void.
- **Bank installments (EG):** full or partial refund, no void.

The connector checks these rules before queueing the job and refuses with a reason the screen can show.

#### Idempotency per write (rule 5)

| Write | Provider key | Mizan strategy |
| --- | --- | --- |
| Create intention | None documented. Behaviour on a repeated `special_reference` is unknown. | Outbox job keyed `<order>:<purpose>:<attempt>`. On a timeout or 5xx, Mizan **abandons** that attempt and creates `attempt+1`. Safe because a lost intention's `client_secret` never reached the customer, so it cannot be paid. A callback for an unknown attempt's `merchant_order_id` is still matched by its order prefix, re-read and posted, never dropped. |
| QuickLink (if used) | `reference_id` must be unique (400 if it already exists) | Same key. A duplicate 400 means the link exists. A lookup by reference is unconfirmed, so cancel it and use a new attempt. Never send `email`/`phone_number`. |
| Refund | None | One job in flight per parent transaction. The job stores the parent's `refunded_amount_cents` **before** sending. On a timeout or ambiguous reply, Mizan never re-sends (Skill: "never auto-retry after a timeout"; "a 200 alone doesn't prove the result"). It re-reads the parent with backoff: a total ≥ before + amount means done; still unchanged after the verify window → retry once more; anything else → review. |
| Void | None | Re-read `is_voided` before any retry. Past the business day, switch to a refund only by a team decision. |
| Capture | None | One in flight per transaction. Compare `captured_amount` before and after, as for refunds. |

#### Pending methods, sandbox, fees, settlement

- **Methods (EG)** (Docs overview): cards (Visa, Mastercard, Amex, 3DS), Apple Pay, Google Pay; wallets Vodafone Cash, Orange Cash, e& money, WE Pay; BNPL valU, Sympl, Souhoola, Halan, TRU, MOGO. The lists continue ("and others"), and availability depends on the account. The SDKs use the names `kiosk` (Python) and `card-installment` (Node).
- **InstaPay through Paymob:** treat as unavailable ("launching soon", WooCommerce listing).
- **Other regions:** KSA cards, Apple Pay, Google Pay, STC Pay, Tabby, Tamara; UAE cards, Apple Pay, Google Pay, Tabby, Tamara; Oman Oman Net (WooCommerce listing).
- **Kiosk** (EG only; Docs `kiosk-egy`): the customer generates a reference and pays cash; no refunds. A `pending=true` callback marks "reference generated" (Docs callbacks). Payment mode is `bank_transfer`-like: no shipping until it is paid.
- **Test credentials** (Docs `test-credentials`): Mastercard 5123456789012346 and 5123450000000008, Visa 4111111111111111, name "Test Account", expiry 01/39, CVV 123. Wallet 01010101010, MPin 123456, OTP 123456. PayMe is Live only (FAQ).
- **Fees:** there is no per-transaction fee field. `merchant_commission` and `order.commission_fees` are null in every official sample. Fees come from the store's rate card (`fee_is_actual=false`) and are replaced from settlement files later. The published Egypt standard rate is **2.75% + 3 EGP per transaction**, with no monthly fee (paymob.com/en/pricing). Use it only as a pre-filled suggestion; fees are contractual (Skill).
- **Settlement:** Paymob's own pages disagree. The pricing page says "weekly". The WooCommerce readme says T+1 for most methods, BNPL may vary, and instant settlement is optional. Treat timing as a per-merchant setting.
- **Reports:** there is no server-to-server settlement or payout API. The dashboard shows settlement summaries and balance, and downloads payment, settlement and refund reports; the format is unpublished. Paymob's MCP server (`export_transactions`, `get_merchant_transfers`, and others) is Egypt only and signs in by dashboard password through the browser, so it can't serve as an unattended connector (Docs `ai-solutions/model-context-protocol-mcp`). Reconciliation is a **file import** plus the per-transaction re-read.

#### Confirm before building

1. `POST /v1/intention/` against a sandbox account. Docs leave both host and path blank; it is in Postman only.
2. What a repeated `special_reference` does (rejected, ignored, or returns the existing intention).
3. The `expiration` unit and default, and how long `client_secret` lives. A third party says seconds and 3600, but that source is now 404. This decides between intention and QuickLink for a 24 h offer.
4. Required `billing_data` fields beyond `phone_number`, the phone format (the Python SDK sends `"9135210487"` with no `+`), and whether `"NA"` placeholders are accepted.
5. Whether the item amounts must add up to `amount`.
6. Where the HMAC secret is in the current dashboard, and whether Test and Live differ. Sources disagree: Profile tab; Settings → Account Info → HMAC with a Test/Live toggle; a "Recreate" button.
7. How null values (for example `source_data.pan` for wallet or kiosk) appear in the HMAC string. Verify per method with sandbox callbacks.
8. The GET redirect's keys: `order` vs `order_id`, and `source_data.pan` vs `source_data_pan`.
9. Whether the dashboard Webhook URL is **also** called when `notification_url` overrides it.
10. Whether pending (3DS, wallet) callbacks are sent at all. Kiosk under Unified Checkout: where `bill_reference` appears, its expiry, and callbacks when a reference is created or expires. Whether Fawry is a Paymob kiosk partner (current docs name Aman and Masary).
11. Refunds and voids as child transactions: which transaction gets the callback, and the child's `parent_transaction` value. Not documented today.
12. Response and error shapes for refund, void and capture: over-refund, short merchant balance (a legacy warning says you need enough balance), void after cutoff, duplicate refund. Whether an identical repeated refund is deduped.
13. The minimum refund amount (legacy "1 pound", snippet only).
14. The void cutoff time and time zone per region.
15. `is_auth: true` vs `payment_type: "AUTH"` per account.
16. Inquiry token scope: Postman says the API Key is the same in Test and Live, but the Skill says a test token sees only test transactions. The Skill also shows `?token=` in place of Bearer.
17. The listing endpoints `GET /api/acceptance/transactions?page=N`, `GET /api/ecommerce/orders?page=N` and `GET /api/ecommerce/orders/{id}` (all attempts): Skill only, page size and date filters unknown.
18. QuickLink: official path, content type, `expires_at` format and time zone, the cancel endpoint, lookup by `reference_id`.
19. Methods per region through the Intention API, mada in KSA (the sources place mada in UAE or in no country), BNPL settlement timing, Apple Pay in test mode.
20. Whether `merchant_commission` / `commission_fees` are filled on live transactions.
21. The settlement report's format and columns. Get a sample export from a pilot merchant.
22. Rate limits (none published).
23. That new accounts start in Test mode with a test card integration (not stated on the credentials page).
24. Hosts `pakistan.paymob.com` and `flashapi.paymob.com` (not verified; not used).
25. The time zone of `created_at` (no offset, e.g. `2024-06-13T11:33:44.592345`): server UTC or Cairo time. The engine hands it on as Paymob gives it; the platform must store it with the right offset.
26. A refund on a capture child (auth/capture flows): whether the authorization's `refunded_amount_cents` moves too. Until confirmed, one that the authorization does not show goes to review.
27. The digest of the docs' HMAC example: their secret is not printed. Check one sandbox callback with the account's secret.

## 8. Marketplaces (V2)

| Marketplace | Markets | Access | Notes |
| --- | --- | --- | --- |
| Noon | KSA, UAE, EG | Seller partner / API access through Noon seller support `[CONFIRM]` | Listings, stock, orders, payouts |
| Amazon (SP-API) | EG, KSA, UAE | Developer registration in Seller Central; app authorization by each seller | Listings, inventory, orders, FBA stock, settlement reports |
| Jumia | EG, Maghreb | Seller Center API `[CONFIRM]` | Listings, stock, orders |

Marketplace orders enter M1 with `channel = 'marketplace'`; marketplace-fulfilled stock is a separate warehouse; payouts are reconciled in M8.

## 9. Messaging channels (M2, M9, M17)

| Channel | Access | Phase |
| --- | --- | --- |
| WhatsApp Cloud API | Tech Provider + Embedded Signup v4 (section 5) | MVP |
| Instagram and Messenger | Meta app with messaging permissions, App Review | V2 |
| Email | Inbound forwarding address per tenant + outbound with SPF/DKIM | V2 |
| Web chat | Mizan widget on the storefront | V2 |
| SMS / voice | Local provider with sender IDs (EG, KSA). ✅ E6-7: any vendor plugs in as a `MessagingProvider` (`packages/engine/src/connectors/messaging`); none connected = links sent by hand | MVP (fallback) |

## 10. Accounting tools (M19)

| Tool | Use | Phase |
| --- | --- | --- |
| Zoho Books | Journal entries, invoices, payments | V2 |
| Odoo | Journal entries via API | V2 |
| Daftra | Popular in Egypt and KSA; journal sync | V2 |
| CSV / Excel | Universal fallback | MVP |

## 11. Tax compliance (per merchant)

**KSA — ZATCA Fatoora Phase 2:** merchant generates OTP in Fatoora portal (60 min) → Mizan generates key pair + CSR → compliance CSID + compliance checks → production CSID (1 year) → B2B invoices cleared in real time; B2C reported within 24 h.

**Egypt — ETA e-receipt:** decision-based scope (merchant checks ETA obligated-taxpayer inquiry) → Mizan registers as software POS per outlet → GS1/EGS item codes; offline receipts submitted within 24 h.

Ships after the MVP. Hire a local tax adviser per country before building.

## 12. Infrastructure services

| Service | Use | Route | Phase |
| --- | --- | --- | --- |
| Firebase Auth + FCM | Sign-in (email, phone OTP), push to ops app | Self-serve | MVP |
| Google Maps Platform | Address search, pins, zones | Self-serve | MVP |
| KSA National Address | Validate Saudi short addresses | Contract | V2 |
| SMS + voice provider | Fallback messages, click-to-call, voice bot | Contract (local sender IDs EG + KSA) | MVP |
| LLM provider | AI analyst, reply classification | Self-serve; prefer regional processing + DPA | V3 |
| FX rates | Daily rates | Self-serve or central bank | MVP |
| Transactional email | Alerts, reports | Self-serve (SPF, DKIM) | MVP |

## 13. Access playbook — apply in this order

| When | What |
| --- | --- |
| **Now** | Meta business verification · WhatsApp Tech Provider · Shopify protected data L2 · Salla partner verification · Meta partner contact for CAPI |
| Discovery | Bosta and J&T API access · Paymob merchant + keys · SMS/voice vendor · EasyOrders and LightFunnels apps · shortlist of second gateway (Kashier, Fawry or Moyasar) |
| Before pilot | WhatsApp templates approved · Shopify app review · production keys in Secret Manager |
| Before KSA | Salla and Zid apps reviewed · SMSA, SPL, Aymakan · Moyasar / HyperPay / Tap · Tabby, Tamara · ZATCA onboarding |
| V2 | Noon and Amazon developer access · Instagram/Messenger App Review · accounting tool partner accounts |

**Prepare before applying:** commercial registration and tax card (Egypt); Saudi CR + VAT before KSA; verified Meta business portfolio; public website + privacy policy + terms on Mizan's domain; data protection document (encryption, retention, access logs, incident response); one technical owner per platform account.

## 14. Sources (checked October 2026)

- Shopify · protected customer data — shopify.dev/docs/apps/launch/protected-customer-data
- WooCommerce · REST API authentication — developer.woocommerce.com/docs/apis/rest-api/authentication
- EasyOrders · public API — public-api-docs.easy-orders.net/docs/intro
- LightFunnels · authentication — developer.lightfunnels.com/authentication
- Salla · developer preparation — docs.salla.dev/playbook/building/dev-preparation
- Zid · create your first app — docs.zid.sa/create-first-app
- YouCan · OAuth — docs.youcan.shop/store-admin/introduction/oauth
- Bosta · Node.js SDK — github.com/bostaapp/bosta-nodejs
- SPL · getting started with APIs — wiki.partners.splonline.com.sa/spl-apis/getting-started-with-lis-apis
- Meta · WhatsApp pricing — developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- Meta · onboarding as a Tech Provider — developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider
- Meta · Marketing API access — developers.facebook.com/docs/marketing-api/access
- Meta · Conversions API for platforms — developers.facebook.com/docs/marketing-api/conversions-api/guides/conversions-api-for-crm
- TikTok · Events API — ads.tiktok.com/help/article/getting-started-events-api
- Snap · Conversions API — developers.snap.com/api/marketing-api/Conversions-API/GetStarted
- Paymob · developer overview — developers.paymob.com/paymob-docs/developers/intention-apis/overview
- Shopify · Order object (totalReceivedSet, totalOutstandingSet, totalRefundedSet; OrderDisplayFinancialStatus) — shopify.dev/docs/api/admin-graphql/2026-10/objects/Order
- Moyasar — moyasar.com/en
- Tabby · API reference — docs.tabby.ai/api-reference/overview
- ZATCA Phase 2 onboarding (vendor guide, secondary) — wafeq.com/en-sa/tax-and-reporting/zatca-phase-2-integration
