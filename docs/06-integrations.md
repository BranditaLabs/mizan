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
| Shopify OAuth install | ✅ E3-1: install / App Store entry / callback / claim, token exchange through `send()` (`exchangeShopifyCode`), fake OAuth in `FakeShopify` | `apps/api/src/modules/connections/shopify`, `packages/engine/src/connectors/shopify/oauth.ts` |
| Shopify webhook registration | ✅ E3-2: `connection.connected` → `shopify.syncWebhooks` engine job (converges subscriptions, safe to repeat) | `ShopifyConnector.syncWebhooks`, `apps/api/src/integrations/shopify-connected.consumer.ts` |
| Shopify compliance webhooks | ✅ E3-3: `/webhooks/shopify/gdpr` → `privacy_requests` → redact / compile (docs/07 §3) | `parseComplianceWebhook`, `apps/api/src/modules/privacy` |
| Shopify uninstall | ✅ E3-4: `app/uninstalled` → `ConnectionLifecycle.providerRevoked` (disconnect, delete token, drop queued jobs); `FakeShopify.uninstall()` revokes tokens (401) and drops subscriptions | `apps/api/src/integrations/connection-lifecycle.ts` |
| Shopify nightly reconciliation | ✅ E5-8: `shopify.reconcile` job per store day: `orders(query: "created_at:>='…' created_at:<'…'")`, 100 per page; orders the engine never recorded are ingested as if their webhook had come | `MizanEngine.shopifyReconcileJob`, `ShopifyConnector.ordersPage` |
| Shopify initial backfill | ✅ E3-5: on every connect, `shopify.backfill` job chain — orders created in the last 60 days, then all products, one page (50) per job, cursor in the next job (resumable), cost-limited; newest run wins on reconnect; progress in `/v1/admin/integrations/health` → `backfill` | `MizanEngine.shopifyBackfillJob`, `ShopifyConnector.ordersPage/productsPage` |
| EasyOrders, WooCommerce, LightFunnels | ⏳ MVP backlog | use `/new-connector` |
| J&T, Mylerz | ⏳ MVP / V2 | — |
| Claude (Anthropic Messages API) | ✅ E6-12 offer writer: raw HTTP through `send()` (breaker, bucket, error taxonomy: 429 `rate_limit_error` and 529 `overloaded_error` retried with `retry-after`, 401/403/402 stop, 400/404 ours), `anthropic-version: 2026-10-21`, structured JSON output, `fallbacks: "default"` (`server-side-fallback-2026-07-01`), low effort; refusals and cut-off answers fall back to Mizan's own offer; fake server + chaos tests. Key `ANTHROPIC_API_KEY` (Secret Manager), model `ANTHROPIC_MODEL` (default `claude-opus-5-5`) | `packages/engine/src/connectors/ai/claude.ts` |
| WhatsApp Cloud API | ✅ E6-4a connector: templates with quick replies, reply buttons, lists, text, template review status; Meta body-coded errors classified (`send()` `classify` hook); webhook signature, subscription challenge, messages and statuses parsed through the `Resolver`; fake Graph server + chaos suite (10/25/50 %). ⏳ Connecting a number (E6-4b) and the API webhook endpoint (E6-10) | `packages/engine/src/connectors/whatsapp` |
| Paymob (links, refunds, transactions) | ⏳ MVP backlog | — |
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

### Shopify specifics (already handled by the engine)

- API version pinned `2026-10`; Shopify versions quarterly. Fall-forward is detected from `X-Shopify-API-Version`.
- Cost-based rate limit (points/second by plan: 100 / 200 / 1,000 / 2,000; max single query cost 1,000). The limiter syncs to `extensions.cost.throttleStatus`.
- Webhooks: HMAC header `X-Shopify-Hmac-SHA256` (base64 HMAC-SHA256 of the raw body with the app's client secret); respond within 5 s; Shopify retries 8 times over 4 hours; dedupe on `X-Shopify-Event-Id`.
- `inventorySetQuantities` requires the `@idempotent(key:)` directive since 2026-04; the engine uses compare-and-set (`changeFromQuantity`).
- `productUpdate` cannot update variants → `productVariantsBulkUpdate` for price and compare-at price.
- Webhook subscriptions (✅ E3-2): on every connect the engine converges this app's subscriptions to `ORDERS_CREATE`, `ORDERS_UPDATED`, `ORDERS_CANCELLED`, `PRODUCTS_UPDATE`, `APP_UNINSTALLED` → `PUBLIC_URL/webhooks/shopify/{connectionId}` (job `shopify.syncWebhooks`: list, delete ours that point elsewhere, create the missing ones; duplicates refused by Shopify are fine). Uses `uri` on `WebhookSubscriptionInput` (2025-04+); reading falls back to `endpoint.callbackUrl`. **Confirm on a dev store** that 2026-10 accepts `uri` on create.
- Order edits (✅ E6-13, accepted offers): `orderEditBegin(id)` → `orderEditAddVariant(id, variantId, quantity, allowDuplicates: false)` → `orderEditAddLineItemDiscount(id, lineItemId, discount: { percentValue, description })` → `orderEditCommit(id, notifyCustomer: false, staffNote)`; needs `write_order_edits`. The commit is not idempotent: the engine reads the order first (tag `mizan-offer-<id>` or a line with the variant), verifies a lost commit by reading again, and tags last. `userErrors` (sold out, cancelled order) are reported once as `validation`, never retried. **Confirm on a dev store** that 2026-10 keeps `calculatedOrder.addedLineItems` and `OrderEditAppliedDiscountInput.percentValue`, and whether the payment terms / COD outstanding follow the new total.
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
- **Confirm before production:** numeric state codes (Bosta's own SDKs disagree), `deliveries/search` body, `dropOffAddress` city field (`city` / `cityCode` / `cityId`), public tracking URL.

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
