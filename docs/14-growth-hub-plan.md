# 14 — Growth hub plan: attribution, CRM and performance marketing

> **Status:** plan v1, 30 Oct 2026, for the owner's approval. Covers M7 (ad-to-cash attribution), M9 (CRM, loyalty, campaigns), the ad feedback loop and the performance-marketing toolkit that make Mizan the brand's e-commerce hub. Stories are added to `docs/10-backlog.md` (section *Growth hub*) once approved.
>
> **بالمصري:** ميزان مش بس بيشغّل الأوردر لحد الكاش؛ هيبقى كمان المكان اللي بيعرف كل إعلان جاب كام أوردر اتسلّم فعلاً، ويعلّم منصات الإعلانات مين العميل اللي بيدفع، ويبني عملاء بيرجعوا تاني، من غير ما التاجر يحتاج 5 أدوات تانية.

## 1. The idea in one loop

```
   Ad (Meta · TikTok · Snap · Google · click-to-WhatsApp · influencer code)
        │  click id, UTM, code, ctwa_clid
        ▼
   Store checkout ──► Mizan order ──► confirmed ──► shipped ──► delivered + cash ──► profit (M5)
        ▲                 │               │                          │                 │
        │                 ▼               ▼                          ▼                 ▼
        │           risk score     "Confirmed" event         "Purchase" event     LTV per customer
        │                                 │                   (delivered value)    and per campaign
        │                                 └──────────┬──────────────┘                 │
        │                                            ▼                                ▼
        └──────────── platforms learn from REAL buyers ◄──── audiences: VIP seeds, refuser exclusions
                      (CAPI, offline conversions)            CRM: segments, WhatsApp campaigns, loyalty
```

Ad platforms optimise toward whoever "purchased". With cash on delivery in Egypt, 20–40% of those purchases never pay `[pilot data to confirm]`. Every other tool reports the leak after it happens; Mizan stops it in three places:
1. **Before shipping:** confirmation, risk score, deposit (built).
2. **In the ad platforms:** they get told who really paid (this plan).
3. **In the customer base:** it grows the buyers who pay and excludes the ones who don't (this plan).

## 2. Where we start (built)

| Piece | State |
| --- | --- |
| Ad spend per day and platform (manual, CSV), spread over orders | ✅ E9-3 |
| Real profit per order, product, day; ad cost inside it | ✅ E9-2, E9-4, E9-5 |
| **True ROAS, reported ROAS, projected, cost per delivered order** | ✅ M7-1 |
| Metric layer (`true_roas`, `cost_per_delivered_order`, `ad_spend`) | ✅ E15-1, M7-1 |
| `orders.utm` column (empty today), `customers` (phone hash, counts, LTV, WhatsApp opt-in/out) | ✅ schema, partly filled |
| WhatsApp Cloud API (templates, buttons, inbound webhook, opt-in/opt-out) | ✅ E6-4, E6-4b, E6-10 |
| Automations (events, conditions, actions, recipes, run log) | ✅ E11 |
| Store credit ledger, refunds, conversion to prepaid | ✅ E14 |
| Outbox + `send()` with circuit breaker, fakes + chaos suite pattern | ✅ engine |

**Gaps this plan fills:**
- where each order came from;
- campaign-level results;
- events back to the platforms;
- audiences;
- customer profiles and segments;
- marketing campaigns;
- loyalty;
- funnel and cohort analytics;
- the toolkit: links, codes, catalogs, digests, health checks.

## 3. Architecture

### 3.1 New data (migrations, all with RLS)

| Table | Holds | Notes |
| --- | --- | --- |
| `order_sources` | One row per order: `platform`, `channel` (paid, organic, whatsapp, influencer, direct, unknown), `utm_*`, `click_id` + kind (fbclid, ttclid, gclid, ScCid, ctwa_clid), `campaign_id/adset_id/ad_id` when known, `discount_code`, `landing_url` (no query PII), `first_seen_at`, `confidence` | Filled from the store order (and later the storefront snippet). Unknown stays unknown |
| `ad_accounts` | Connected ad accounts: platform, external id, currency, time zone, token ref (secrets), pixel/dataset id, status | Exists in 0001 as a sketch; extend |
| `ad_campaigns` (+ `ad_sets`, `ads`) | Names and ids from imports or CSV, status, objective | Lets codes/UTMs map to names |
| `conversion_events` | Each event to each platform: order, event (`ConfirmedOrder`, `Purchase`, `Refund`…), value, currency, `event_id` (dedup with the pixel), status, attempts, platform response, `sent_at` | An outbox-backed log; replayable |
| `customer_profiles` (extends `customers`) | Net LTV, delivered/refused counts, refusal rate, first/last order, avg gap, preferred payment, acquisition source (first order's source), RFM scores, segments cache | Recomputed on order and profit events |
| `consents` | Per customer and channel (whatsapp, sms, email) and purpose (transactional, marketing): state, source, at, evidence | Supersedes the two columns on `customers` |
| `segments`, `segment_members` | Rule (JSON, same condition language as automations), size, last computed | Default segments seeded |
| `audiences`, `audience_syncs` | Segment → platform custom audience, hashed identifiers sent, counts, last sync | Consent- and policy-gated |
| `campaigns`, `campaign_messages` | WhatsApp/SMS/email campaign: segment, template, schedule, caps; per-recipient status and outcome (reply, order, delivered revenue) | Template marketing category |
| `discount_codes` | Code → campaign / influencer, payout rule | Codes created in the store (Shopify discount API) or typed |
| `loyalty_accounts`, `loyalty_ledger` | Points per delivered/paid order, tiers, redemptions | Store credit stays in `store_credit_ledger` |

### 3.2 Events and actions (catalogue, `docs/13`)
- **Events:**
  - attribution: `order.source_resolved`, `attribution.campaign_alert`;
  - conversion API: `capi.event_sent`, `capi.event_failed`;
  - CRM: `customer.profile_updated`, `customer.segment_entered` / `customer.segment_left`, `consent.changed`;
  - campaigns: `campaign.sent`, `campaign.replied`, `campaign.converted`;
  - loyalty: `loyalty.points_earned`, `loyalty.tier_changed`;
  - audiences: `audience.synced`.
- **Actions:** `capi.send_event`, `audience.sync`, `campaign.send` (one customer, a template), `customer.add_tag`, `loyalty.add_points`, `discount.create_code`, `report.send` (digest).

### 3.3 Rules that don't change
1. **Canonical model.** Platform payloads are mapped to canonical types.
2. **Every outbound call goes through the outbox** with an idempotency key (`event_id`).
3. **All HTTP goes through `send()`**, and each connector gets a fake server with the platform's quirks plus the chaos suite.
4. **Personal data:** sent only hashed (SHA-256 of normalised phone and email), only with a lawful basis, and logged.
5. **Never guess:** an order without a source is "unknown" and is never forced onto a campaign.
6. **Money:** minor units, with FX per day.
7. **Arabic and English are equal** in every screen.

## 4. Workstreams and stories

Sizes are `S` ≤ 1 week, `M` ≈ 1–2 weeks, `L` ≈ 2–4 weeks for one engineer with Claude Code. Each story includes API + web (AR/EN) + tests + docs, per the definition of done.

### A. Attribution: know which ad brought which paying order (M7)

| ID | Story | Size | Needs |
| --- | --- | --- | --- |
| ✅ M7-1 | True ROAS, reported vs real, projected, cost per delivered order | M | — |
| ✅ M7-2 | **Order source capture.** From Shopify, read the customer journey (first and last visit: source, UTM, landing page), `landing_site`, `referring_site` and note attributes; from WooCommerce, read order meta (`_wc_order_attribution_*`). Parse click ids, UTMs and discount codes, then resolve the source with a ranked `Resolver`. Backfill the last 90 days. Results go in `order_sources`. | M | Shopify `read_orders` (have) `[CONFIRM customerJourneySummary access level]` |
| **M7-3** | **Campaign results.** ROAS, cost per delivered order, delivered rate and fake-order share **per platform, campaign, ad set and ad**, with unattributed orders always shown. Spend comes from CSV with campaign columns (extend the E9-3 importer). Automation trigger `attribution.campaign_alert` fires when a campaign's fake share or true ROAS crosses a threshold. Recipe: "Pause-worthy campaign" sends a notification. | M | M7-2 |
| **M7-4** | **Click-to-WhatsApp attribution.** The WhatsApp inbound webhook already arrives; store `referral` (`ctwa_clid`, `source_id`, ad headline) on the conversation, then link it to the order the customer places. This is a big channel in Egypt. | S | E6-4 (have) |
| **M7-5** | **Discount codes and influencers.** A code maps to a campaign or creator, with orders, delivered revenue, profit and the creator's payout (percentage of *delivered* revenue). Codes are created in Shopify through `discountCodeBasicCreate`, or typed in. | M | Shopify `write_discounts` scope |
| **M7-6** | **Spend import from APIs.** Meta Marketing API (`ads_read`), TikTok Marketing API, Snap Marketing API, Google Ads API: daily spend, impressions and clicks per campaign, ad set and ad. Accounts connect over OAuth; tokens are kept in secrets; the job runs hourly for today and nightly to restate the last 7 days. Fakes and the chaos suite are built first; it goes live with each approval. | L | D-3 approvals (Meta App Review + Advanced Access, TikTok app, Google developer token, Snap OAuth app) |
| **M7-7** | **Storefront snippet (optional).** A small script in the theme (Shopify app embed) stores the click ids and `event_id` on the cart, so attribution survives redirects and pixel dedup works. | M | Shopify app embed review |

### B. Feedback loop: teach the platforms who really pays

| ID | Story | Size | Needs |
| --- | --- | --- | --- |
| **FB-1** | **Conversion API framework.** The `conversion_events` outbox: which events to send per payment method (table in M07), dedup `event_id` shared with the browser pixel, hashing, retries, a replay button, and a delivery log on the order and in Settings → Ads. Fakes for each platform. | M | — |
| **FB-2** | **Meta Conversions API.** Sends `ConfirmedOrder` on confirmation and `Purchase` on delivery or payment, with the delivered value. Refused, cancelled or refunded orders get no purchase (or a refund event where supported). Event match quality is shown. Auth uses the merchant's system-user token or dataset access token, so **no App Review is needed**; Meta Business Extension comes later. | M | Merchant generates token in Events Manager `[CONFIRM]` |
| **FB-3** | **TikTok Events API** and **Snap Conversions API**: same events, per-pixel tokens generated by the merchant. | M | Merchant tokens |
| **FB-4** | **Google Ads offline conversions** with click id (gclid) and enhanced conversions, plus **adjustments**: a refused order is retracted and a partial delivery is restated. | M | Google Ads developer token (D-3) |
| **FB-5** | **Profit as the signal (POAS).** An option to send each order's *net profit* (or margin-weighted value) as the purchase value, so value-based bidding chases profit, not revenue. Off by default; it shows the effect on reported ROAS. | S | FB-2 |
| **FB-6** | **Audiences.** Segment → custom audience on Meta, TikTok, Snap and Google: seeds for lookalikes (VIP, repeat buyers who pay), exclusions (frequent refusers, recent buyers), and remarketing (one-time buyers). Hashed, consent-gated, synced daily, with the platform's custom-audience terms accepted in the flow. | L | Meta `ads_management` (App Review); TikTok and Google audience APIs |

### C. CRM: one customer, real value, consent first (M9)

| ID | Story | Size | Needs |
| --- | --- | --- | --- |
| **CRM-1** | **Customer profiles.** One per normalised phone across the merchant's stores, holding orders, delivered, refused, refusal rate, **net LTV from M5**, average gap, preferred payment, first source (from M7-2), tickets and messages. Customers list and profile screen, with audited reveal as for orders. Backfilled from existing orders. | M | — |
| **CRM-2** | **Consent centre.** Per channel and purpose, recording where consent came from (checkout box, WhatsApp reply, form) and when. STOP and «إيقاف» are honoured at once (built for WhatsApp). Covers migration from the current columns and import of the store's marketing opt-in (Shopify `emailMarketingConsent`, `smsMarketingConsent`). | M | Counsel review of consent wording (E13-3) |
| **CRM-3** | **Segments.** A rule builder using the automation condition language, plus seeded defaults: VIP, repeat, at risk, one-time, frequent refuser, COD-only, pays online, by source campaign. RFM scores, live counts, and sizes over time. | M | CRM-1 |
| **CRM-4** | **WhatsApp campaigns.** Pick a segment and an approved *marketing* template with personalisation, then schedule it, with quiet hours, a frequency cap (2 a week), opt-in check at send time, test send, and a cost estimate (Meta per-message pricing). Results come in **delivered revenue and profit**, not clicks. Replies go to tickets (later the inbox, M17). | L | WhatsApp connected; marketing templates approved by Meta |
| **CRM-5** | **Lifecycle flows** as automation recipes: thank-you after delivery with a review ask, replenishment reminder (from product reorder cycle), second-order nudge, win-back, "pay online next time" to COD customers who refused before, VIP early access, and abandoned checkout (Shopify checkouts, `read_checkouts`). | M | CRM-3, CRM-4 |
| **CRM-6** | **Loyalty.** Points on delivered or paid orders (never on refused ones), tiers, redemption as store credit (ledger exists) or a Shopify discount code, and points shown in WhatsApp messages. | M | CRM-1 |
| **CRM-7** | **SMS and email channels** for campaigns and flows (same consent and caps). | M | D-4 vendor choice; email provider |

### D. Full-funnel analytics: from spend to repeat cash

| ID | Story | Size | Needs |
| --- | --- | --- | --- |
| **AN-1** | **Funnel view** per platform and campaign: spend → impressions → clicks (from M7-6) → orders → confirmed → shipped → delivered → paid → repeat within 90 days. Each step's rate and money, plus where the leak is. | M | M7-3 (M7-6 for the top) |
| **AN-2** | **Cohorts and payback.** Customers by acquisition month and source: repeat rate, net LTV at 30/60/90/180 days, CAC (spend ÷ new paying customers), and payback period. | M | CRM-1, M7-2 |
| **AN-3** | **Break-even ROAS per product** from its margin, the target ROAS for the store, and MER (total revenue ÷ total ad spend) next to true ROAS. | S | M7-1 |
| **AN-4** | **Daily digest.** Yesterday's spend, true ROAS, cost per delivered order, the worst campaign, cash collected and profit, sent to the owner on WhatsApp (utility template) or email at 9:00 store time. | S | WhatsApp connected |
| **AN-5** | **Creative and product insights.** Which ads and products bring paying customers vs refusers (refusal rate by ad, by product, by area). | M | M7-3 |

### E. Performance-marketing toolkit (so the brand needs no other tool)

| ID | Story | Size | Needs |
| --- | --- | --- | --- |
| **TK-1** | **UTM and link builder.** Consistent UTMs per platform and campaign, short links on the merchant's domain or a Mizan short domain, and click-to-WhatsApp links with a ref. | S | — |
| **TK-2** | **Catalog feeds.** Products → Meta Commerce catalog, TikTok catalog and Google Merchant Center: titles AR/EN, prices, stock (from M4), images. Out-of-stock items leave the feed so ads stop spending on them. | L | Platform approvals (catalog APIs) |
| **TK-3** | **Pixel and CAPI health.** Event match quality, dedup rate, events rejected, and pixel firing on the store `[via platform APIs]`, with alerts. | S | FB-2/3 |
| **TK-4** | **Budget pacing and alerts.** Spend vs plan per platform and month; alerts when true ROAS falls under break-even, spend jumps, or a campaign's refusal rate spikes. These are automation triggers. | S | M7-3 |
| **TK-5** | **Experiments log.** Record a test (creative, audience, offer, COD vs prepaid incentive), its dates and campaigns; Mizan reports the result in delivered profit with a simple significance check. | M | M7-3 |
| **TK-6** | **AI growth analyst (M12).** A weekly review in Egyptian Arabic covering what to scale, pause or fix, grounded only in the store's numbers, with every number linked to its source. It suggests; the merchant decides. Changes to ads (pause, budget) come later and need `ads_management` and explicit approval each time. | M | Anthropic (have), M7-3 |
| **TK-7** | **Agency view for Brandita.** One login across client stores: a portfolio of true ROAS, spend and profit, plus a client-ready monthly report (AR/EN, PDF). This sells the Brandita bundle. | M | M7-3 |

### F. Tools that complete the hub

| ID | Story | Size | Needs |
| --- | --- | --- | --- |
| **TK-8** | **Post-purchase survey.** One question after delivery on WhatsApp ("How did you hear about us?": Instagram, TikTok, a friend, an influencer…). It fills the gaps click tracking misses and is shown next to tracked attribution. | S | WhatsApp connected |
| **TK-9** | **Lead ads and DMs to orders.** Meta and TikTok lead forms, and Instagram and Messenger DMs, become a WhatsApp conversation and then an order (manual order, E5), with the ad kept as the source. Common in Egypt for high-ticket and COD-wary buyers. | M | Meta Lead Ads webhook (`leads_retrieval`); M17 inbox for DMs |
| **TK-10** | **Reviews and UGC.** Ask for a review or a photo after delivery (only delivered, never refused orders), then push it to the store (Shopify product reviews app or metafields) and reuse it in ads with consent. | M | Review app integration `[choose]` |
| **TK-11** | **Affiliates and referral.** A "refer a friend" link or code per customer, with a reward paid only on the friend's **delivered** order, as store credit or points. Payouts to affiliates go through M19. | M | CRM-6 |
| **TK-12** | **Opt-in capture.** A storefront widget (Shopify app embed) and a checkout checkbox that record WhatsApp marketing consent with evidence; click-to-WhatsApp entry links that start the chat (free service window). | S | Shopify app embed |
| **TK-13** | **Creative analytics.** Results per ad creative (thumbnail, hook, format) in delivered profit, with refusal rate per creative: which creatives bring buyers who pay. | M | M7-6 (ad and creative ids) |

## 4·G. The full funnel: who owns each stage

| Stage | What happens | Tool brands use today | In Mizan |
| --- | --- | --- | --- |
| **Plan** | Budget, targets, break-even | Spreadsheet | AN-3 break-even ROAS, TK-4 pacing |
| **Attract** | Ads, influencers, content | Ads Manager, influencer sheet | Spend import M7-6, codes M7-5, links TK-1, catalogs TK-2, creative analytics TK-13 |
| **Capture** | Click → store, lead form, DM, WhatsApp | Pixel, lead form tools, DM inbox | Source capture M7-2/M7-4/M7-7, lead ads TK-9, opt-in TK-12 |
| **Convert** | Checkout, upsell, COD → prepaid | Store, confirmation app | Store sync (built), offers in WhatsApp (built), conversion to prepaid (built) |
| **Verify** | Confirm, score risk, stop fakes | Call centre, confirmation app | M2 confirmation and risk (built) |
| **Deliver** | Ship, track, collect cash | Courier panel | M3 shipping, COD ledger (built) |
| **Measure** | Profit, ROAS, funnel, cohorts | Profit dashboard (Safi), attribution tool, Looker | M5 profit (built), M7-1 true ROAS (built), M7-3, AN-1, AN-2, AN-5 |
| **Teach** | Send real outcomes back to the platforms | CAPI gateway, Zapier | FB-1…FB-6 |
| **Retain** | Segments, campaigns, flows, loyalty | Klaviyo/WhatsApp tools, loyalty app | CRM-1…CRM-7 |
| **Advocate** | Reviews, referrals, affiliates | Reviews app, affiliate app | TK-10, TK-11 |
| **Decide** | What to scale, pause or fix | Agency, analyst | AN-4 digest, TK-6 AI analyst, TK-7 agency view, TK-5 experiments |

With all of it built, a brand replaces seven or eight tools with Mizan:
- profit dashboard;
- attribution tool;
- CAPI gateway;
- confirmation app;
- courier panel;
- CRM/WhatsApp marketing tool;
- loyalty and reviews apps;
- link builder.

## 4·H. How the feedback optimises the ads

Ad platforms bid toward the people most like those who triggered the optimisation event. Mizan changes **which event, with which value, from which people**:

1. **A signal ladder by speed and truth.**
   - `ConfirmedOrder` is sent within minutes of confirmation: fast enough for the platform to learn (enough events a week per ad set). Use it as the optimisation event while a campaign is new.
   - `Purchase` is sent on delivery or payment, with the delivered value: the truth. Use it once there are enough delivered events a week `[platform minimums: CONFIRM, e.g. Meta ~50 per ad set per week]`.
   - Mizan suggests the switch per campaign when the volume allows.
2. **Value that means money.**
   - The purchase value is what was actually delivered: partial deliveries are restated, and refunds are sent as refunds or adjustments where supported.
   - With FB-5, the value is the order's **net profit**, so value-based bidding favours products and buyers that leave money, not just revenue.
3. **Negative space.**
   - Refused and cancelled orders send no purchase, so the platform stops learning from fake buyers.
   - Frequent refusers and recent buyers go to **exclusion audiences** (FB-6).
4. **Better seeds.**
   - Lookalikes are seeded from customers with high **net LTV** who pay (VIP and repeat segments), not from all purchasers.
5. **Match quality.**
   - Hashed phone (and email when known), the click ids, and the same `event_id` as the browser pixel for deduplication.
   - Health is watched with TK-3.
6. **Decisions on top.**
   - Campaign alerts (M7-3), pacing (TK-4) and the AI analyst (TK-6) say where to move budget, based on true ROAS and profit.
   - The merchant or Brandita acts on them. Automated budget changes are a later, opt-in step (decision 5).

**Measured result per pilot:** refusal rate and cost per delivered order, before and after switching a campaign to delivered or profit events, on the same budget (TK-5 logs the test).

## 5. Sequence

Each phase ships something a pilot merchant can use. Approvals run in parallel from week 1.

| Phase | Weeks | Ships | Why first |
| --- | --- | --- | --- |
| **G1 · Know** | 1–5 | M7-2 source capture → M7-3 campaign results → M7-4 click-to-WhatsApp → AN-3 break-even, AN-4 digest, TK-1 links, TK-8 post-purchase survey | No approvals. Gives true ROAS **per campaign**, Safi's strongest feature, already better: delivered, not checkouts. |
| **G2 · Know the customer** | 4–9 | CRM-1 profiles → CRM-2 consent → CRM-3 segments → AN-2 cohorts → AN-5 insights | No approvals. The base for audiences and campaigns. |
| **G3 · Teach the platforms** | 7–12 | FB-1 framework → FB-2 Meta CAPI → FB-3 TikTok/Snap → FB-5 profit as signal → TK-3 health | Uses the merchant's own tokens (no App Review). The moat: platforms learn from real buyers. |
| **G4 · Grow the base** | 10–16 | CRM-4 WhatsApp campaigns → CRM-5 lifecycle flows → CRM-6 loyalty → M7-5 codes and influencers → TK-12 opt-in capture → TK-10 reviews → TK-11 referrals | Needs WhatsApp connected and marketing templates. Repeat revenue, measured in delivered cash. |
| **G5 · Automate and scale** | 14–22 | M7-6 spend APIs → FB-6 audiences → FB-4 Google offline → TK-2 catalogs → AN-1 full funnel → TK-4 pacing → TK-5 experiments → TK-6 AI analyst → TK-7 agency view → CRM-7 SMS/email → TK-9 lead ads and DMs → TK-13 creative analytics | Each one goes live as its approval lands; it's built against fakes before. |

Total ≈ 26 weeks for one engineer, or about 14 with two (attribution and feedback in one stream, CRM and toolkit in the other).

## 6. Owner actions (start now; they gate G3–G5)

| # | Apply for | Unlocks | Typical lead time |
| --- | --- | --- | --- |
| 1 | **Meta business verification** + Mizan app; App Review for `ads_read` (spend), then `ads_management` (audiences); Meta partner contact for Business Extension | M7-6, FB-6, TK-2 | 2–6 weeks |
| 2 | **TikTok for Business developer app** (Marketing API + Events API) | M7-6, FB-3, FB-6 | 2–4 weeks |
| 3 | **Google Ads API developer token** (Basic access, Cloud project, brand verification) | M7-6, FB-4, FB-6 | 1–4 weeks |
| 4 | **Snap Marketing API OAuth app** | M7-6 | 1–3 weeks |
| 5 | **Shopify scopes:** `read_checkouts`, `write_discounts`, `read_customers` marketing consent; app embed for the snippet (M7-7) | CRM-2, CRM-5, M7-5, M7-7 | With the App Store review |
| 6 | **WhatsApp marketing templates** per pilot store (Arabic), and decide who pays Meta's message fees | CRM-4, CRM-5, AN-4 | Days per template |
| 7 | **Email and SMS provider** (D-4) | CRM-7 | — |
| 8 | **Counsel:** consent wording at checkout and in WhatsApp, hashed-data sharing with ad platforms under Law 151 and PDPL, Meta and TikTok custom-audience terms | CRM-2, FB-6 | With E13-3 review |

## 7. Privacy and policy guardrails

- **Hashing:** identifiers sent to platforms are hashed with SHA-256 after normalisation (E.164 phone, lower-case email), never raw. Names and addresses are never sent.
- **Purposes are separate:** marketing needs a marketing consent per channel; confirmation and delivery messages are transactional. Audiences include only customers with a lawful basis `[CONFIRM with counsel: consent vs legitimate interest for exclusion audiences]`.
- **Every send is logged:** platform, event and audience, with what was sent (field names only).
- **Deletion requests** (Shopify redact, a customer's request) remove the customer from audiences on the next sync and stop events.
- **Platform rules:**
  - WhatsApp: opt-in, marketing category, frequency caps.
  - Meta: custom audience terms, no sensitive categories.
  - TikTok and Google: equivalent policies.
- **The AI analyst** reads aggregates, never customer data.

## 8. How we'll know it works (pilot metrics)

| Metric | Target `[set with pilots]` |
| --- | --- |
| Orders with a known source | > 80% of paid-ad orders |
| True ROAS shown per campaign, matching a manual check | 100% of pilot campaigns |
| Delivered events accepted by Meta within 1 hour | > 95% |
| Refusal rate on campaigns optimised with delivered events vs before | Down, measured per pilot |
| Repeat purchase rate at 90 days | Up vs baseline |
| Campaign revenue counted only when delivered | Always |
| Merchant tools replaced | Profit dashboard, attribution tool, CRM/WhatsApp marketing tool, link builder |

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| App approvals slow or refused | G1–G4 need none; merchant-token CAPI; CSV fallbacks for spend |
| Shopify customer journey data missing (privacy settings, app checkout) | Storefront snippet (M7-7); discount codes; click-to-WhatsApp referral; "unknown" shown honestly |
| Platforms change event schemas | Resolver and adapters, fakes per platform, schema-drift alerts (engine pattern) |
| Over-messaging customers | Caps, quiet hours, consent at send time, opt-out rate per campaign with an auto-pause |
| Attribution disputes with the merchant's agency | Show method and window; the Brandita agency view uses the same numbers |

## 10. Decisions for the owner

1. **Order of G2 vs G3:** CRM first (recommended, no approvals), or CAPI first, because it's the moat for ad clients?
2. **Optimise for profit (FB-5) by default** for Brandita clients?
3. **Who owns the platform apps:** Brandita's business account or a separate Mizan entity? This affects all the approvals.
4. **WhatsApp marketing fees:** pass-through at cost, or bundled with a margin (`docs/01` revenue streams)?
5. **Ads write access** (pause campaigns, change budgets) from automations: V3 with approval per action, or never?
