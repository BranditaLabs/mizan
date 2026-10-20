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
| Shopify (Admin GraphQL 2026-10) | ✅ Built and tested (orders, products, inventory CAS, fulfil, mark paid, tags, webhooks) | `packages/engine/src/connectors/shopify` |
| Bosta (v2) | ✅ Built and tested (duplicate-safe create, search, track, cancel, cities, learning status map) | `packages/engine/src/connectors/bosta` |
| Shopify OAuth install + GDPR webhooks | ⏳ Backlog E3 | `apps/api/modules/connections` |
| EasyOrders, WooCommerce, LightFunnels | ⏳ MVP backlog | use `/new-connector` |
| J&T, Mylerz | ⏳ MVP / V2 | — |
| WhatsApp Cloud API | ⏳ MVP backlog | — |
| Meta / TikTok / Snap ads + CAPI | ⏳ V2 | — |
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
- **App Store requirement:** mandatory compliance webhooks `customers/data_request`, `customers/redact`, `shop/redact` (backlog E3).

Scopes: `read_orders` (+ `read_all_orders` for > 60 days), `read_products`, `write_products`, `read_inventory`, `write_inventory`, `read_merchant_managed_fulfillment_orders`, `write_merchant_managed_fulfillment_orders`, `read_customers`.

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

**Pricing since 1 Jul 2025:** per delivered template message (marketing, utility, authentication; per country). Inside the 24-hour customer service window, replies are free and utility templates are free. → Design checkout with a click-to-WhatsApp button so the customer starts the chat and confirmation runs inside the free window.

## 6. Ad platforms (V2)

| API | Use | Access | Gate |
| --- | --- | --- | --- |
| Meta Marketing API | Spend by campaign / ad set / ad | `ads_read`; Advanced Access via App Review; full access tier needs 500+ calls in 15 days with < 15% errors | App Review, business verification |
| Meta Conversions API | Send confirmed and delivered events | Preferred: Meta Business Extension (allowlisted by a Meta rep). Fallback: merchant system-user token | Meta partner contact |
| TikTok Marketing + Events API | Spend + events | Developer app; advertiser OAuth; per-pixel tokens possible | App approval |
| Snap Marketing + Conversions API | Spend + events | CAPI: org admin generates token in Ads Manager; Marketing API: OAuth | Org admin |
| Google Ads API | Spend, offline conversions | Since 10 Sep 2026 access tied to a Google Cloud project; brand verification for Basic access | Cloud project, verification |

## 7. Payments (prepaid nudge)

Payments always go to the **merchant's own** PSP account; Mizan never holds money (avoids a payment licence — confirm with counsel).

| Provider | Markets | Use | Phase |
| --- | --- | --- | --- |
| Paymob | EG, KSA, UAE, OM | Payment links, cards, wallets, Apple Pay | MVP |
| Tabby | UAE, KSA | BNPL nudge for risky COD | V2 |
| Tamara | KSA, UAE | BNPL nudge (direct or via gateway) | V2 |
| InstaPay | EG | Open question: no public merchant API confirmed | V2 |

## 8. Tax compliance (per merchant)

**KSA — ZATCA Fatoora Phase 2:** merchant generates OTP in Fatoora portal (60 min) → Mizan generates key pair + CSR → compliance CSID + compliance checks → production CSID (1 year) → B2B invoices cleared in real time; B2C reported within 24 h.

**Egypt — ETA e-receipt:** decision-based scope (merchant checks ETA obligated-taxpayer inquiry) → Mizan registers as software POS per outlet → GS1/EGS item codes; offline receipts submitted within 24 h.

Ships after the MVP. Hire a local tax adviser per country before building.

## 9. Infrastructure services

| Service | Use | Route | Phase |
| --- | --- | --- | --- |
| Firebase Auth + FCM | Sign-in (email, phone OTP), push to ops app | Self-serve | MVP |
| Google Maps Platform | Address search, pins, zones | Self-serve | MVP |
| KSA National Address | Validate Saudi short addresses | Contract | V2 |
| SMS + voice provider | Fallback messages, click-to-call, voice bot | Contract (local sender IDs EG + KSA) | MVP |
| LLM provider | AI analyst, reply classification | Self-serve; prefer regional processing + DPA | V3 |
| FX rates | Daily rates | Self-serve or central bank | MVP |
| Transactional email | Alerts, reports | Self-serve (SPF, DKIM) | MVP |

## 10. Access playbook — apply in this order

| When | What |
| --- | --- |
| **Now** | Meta business verification · WhatsApp Tech Provider · Shopify protected data L2 · Salla partner verification · Meta partner contact for CAPI |
| Discovery | Bosta and J&T API access · Paymob merchant + keys · SMS/voice vendor · EasyOrders and LightFunnels apps |
| Before pilot | WhatsApp templates approved · Shopify app review · production keys in Secret Manager |
| Before KSA | Salla and Zid apps reviewed · SMSA, SPL, Aymakan · Tabby, Tamara · ZATCA onboarding |

**Prepare before applying:** commercial registration and tax card (Egypt); Saudi CR + VAT before KSA; verified Meta business portfolio; public website + privacy policy + terms on Mizan's domain; data protection document (encryption, retention, access logs, incident response); one technical owner per platform account.

## 11. Sources (checked October 2026)

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
- Tabby · API reference — docs.tabby.ai/api-reference/overview
- ZATCA Phase 2 onboarding (vendor guide, secondary) — wafeq.com/en-sa/tax-and-reporting/zatca-phase-2-integration
