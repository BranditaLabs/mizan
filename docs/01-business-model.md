# 01 — Business model

> **Status:** v1.0, October 2026. Owner: Brandita (Web Development and E-Commerce Solutions).
> ⚠️ Every price, cost and target here is a **proposal to validate** with pilot merchants. Cells marked `[ASSUMPTION]` or `[TO MEASURE]` must be replaced with real figures before they are used in a pitch or a financial model. No market size figure is stated as fact; section 6 gives the method to calculate one.

---

## 1. One-line summary

**Mizan shows every COD store its real profit on every order, and runs the operations that protect that profit: confirmation, shipping, warehouse, returns and cash.** It is sold on its own as a SaaS subscription, and bundled with Brandita's ad management.

العربي: **ميزان بيوري كل متجر ربحه الحقيقي في كل أوردر، وبيشغّل العمليات اللي بتحمي الربح ده: التأكيد، الشحن، المخزن، المرتجعات والكاش.**

---

## 2. Business model canvas

| Block | Mizan |
| --- | --- |
| **Customer segments** | COD-first D2C brands in MENA, about 300 to 20,000 orders a month. Launch: Egypt. Then KSA and the GCC, then the Maghreb, Levant and Iraq. Secondary: agencies and fulfilment operators that run stores for clients. |
| **Value propositions** | Real profit per order (after COGS, ads, shipping, COD fees, returns and agent cost). Fewer refused parcels through risk-scored, dialect-native confirmation. Ad spend tied to delivered cash, with delivered events sent back to the ad platforms. Courier cash matched to orders. One system instead of courier portals, WhatsApp groups and spreadsheets. |
| **Channels** | Brandita's existing ad clients (first 10 design partners). Done-for-you onboarding. Shopify App Store and other storefront app stores. Courier partnerships (Bosta first). Arabic content, webinars and founder communities. |
| **Customer relationships** | Assisted onboarding for every merchant at launch; a named success manager on Scale and above; in-app chat support in Arabic and English; monthly profit review for bundle clients. |
| **Revenue streams** | Monthly or annual subscription by order volume; per-order overage; messaging pass-through with margin (WhatsApp, SMS, voice); bundle with Brandita ad management; Enterprise contracts; later, paid add-ons (extra countries, risk network, AI analyst). |
| **Key resources** | The integration engine (`packages/engine`); the profit model; the confirmation script library in Egyptian, Gulf, Darija, Levantine and Iraqi Arabic; Brandita's ad-operations know-how and client base; over time, the shared risk network data. |
| **Key activities** | Building and maintaining connectors (storefronts, couriers, WhatsApp, ad platforms); onboarding; support; publishing proof (case studies). |
| **Key partners** | Storefronts (Shopify, EasyOrders, LightFunnels, WooCommerce, Salla, Zid, YouCan); couriers (Bosta, J&T, Mylerz, Aramex, SMSA, SPL, Aymakan); Meta (WhatsApp Tech Provider, Marketing API, CAPI); TikTok, Snap, Google; payment providers (Paymob, Tabby, Tamara); cloud provider. |
| **Cost structure** | Product and engineering team (largest cost); cloud hosting; messaging costs (passed through); third-party APIs (maps, SMS, LLM); support and onboarding staff; app-store and payment fees; legal and compliance per country. |

---

## 3. The problem we solve

A COD merchant sees revenue at checkout. What reaches the bank is smaller, and no tool shows the gap per order:

| Leak | What happens | Who pays today |
| --- | --- | --- |
| Fake and duplicate orders | Agent time and courier legs spent on orders that were never real | Ops team, courier fees |
| Refused parcels (RTO) | Two shipping legs paid, product handled twice, nothing collected | Merchant margin |
| Courier and COD fees | Per-parcel and collection fees that rarely reach the P&L | Hidden in "shipping" |
| Cash held by couriers | Settlements late, short or missing; matched by hand | Finance team, cash flow |
| Ads trained on non-buyers | Pixels learn from purchases that never pay, so spend chases the wrong people | Ad budget |

Today each leak lives in a different tool (courier portal, WhatsApp group, Ads Manager, Excel) or in no tool at all.

---

## 4. Customer segments and ICP

### 4.1 Launch ICP (Egypt)

- D2C brand selling mainly cash on delivery.
- **500 to 5,000 COD orders a month.**
- Storefront: Shopify, WooCommerce, EasyOrders or LightFunnels.
- Spends on Meta or TikTok ads.
- 1 to 3 couriers; 2 to 10 confirmation agents.
- Pain: RTO, fake orders, not knowing which products and campaigns actually make money.

### 4.2 Personas

| Persona | Job to be done | Today's tool | What Mizan gives them |
| --- | --- | --- | --- |
| Founder / owner | Know real profit and where money leaks | Spreadsheets, gut feel | Profit home screen; profit by product, campaign, courier |
| Ops manager | Ship only real orders, track every parcel | Courier portals, WhatsApp groups | One order queue, risk score, one-click shipping |
| Confirmation agent | Confirm fast, hit daily targets | Phone, Excel | Prioritized queue, scripts, click-to-call, commissions |
| Warehouse staff | Pack the right item, no oversell | Paper lists | Scan-to-pack app that works offline |
| Media buyer | Scale campaigns that deliver | Ads Manager only | Cost per delivered order, delivered ROAS, CAPI events |
| Accountant | Match courier cash to orders | Manual reconciliation | Settlement matching, cash-in-transit view |

### 4.3 Segments by region

| Region | Main pain | Mizan's lead feature | Phase |
| --- | --- | --- | --- |
| Egypt | COD fraud, high RTO, courier cash leakage | WhatsApp confirmation, cash reconciliation, prepaid nudge | MVP |
| KSA and GCC | High ad costs, BNPL growth, e-invoicing | Ad attribution, BNPL nudge, ZATCA e-invoicing | V2 |
| Maghreb | COD-heavy, French and Darija, fragmented couriers | Darija and French bots, courier routing | V3 |
| Levant and Iraq | Near-total COD, weak addresses | Location pin, agent-led confirmation | V3 |

### 4.4 Who we do not serve (for now)

- Marketplace-only sellers (Amazon, Noon, Jumia) with no own store.
- Stores under about 100 orders a month (served by the Free plan, not sold to).
- Brick-and-mortar POS needs; purchase orders; full accounting ledger (Mizan exports instead).

---

## 5. Value proposition

### 5.1 Positioning

> Order tools tell you where the parcel is. **Mizan tells you if it made money.**

### 5.2 Five capabilities competitors do not offer together

1. **True profit per order:** automatic P&L with COGS, ads, shipping, COD fee, RTO loss and agent cost.
2. **Ad-to-cash attribution:** ad spend tied to delivered orders; confirmed and delivered events sent to Meta, TikTok and Snap server-side.
3. **COD cash reconciliation:** courier settlements matched to expected cash; missing money flagged.
4. **Regional risk network:** a shared, hashed trust score per phone number across merchants (opt-in, source never revealed).
5. **Dialect-native confirmation:** WhatsApp and voice scripts in Egyptian, Gulf, Darija, Levantine and Iraqi Arabic, with a location pin.

### 5.3 Proof we must produce (pilot)

| Claim | How we measure | Target |
| --- | --- | --- |
| RTO goes down | RTO rate in 60 days before vs after onboarding | `[TO MEASURE]` baseline with 10 pilots |
| Profit per delivered order goes up | Net profit ÷ delivered orders, before vs after | North-star metric |
| Less agent time | Auto-confirmation share; orders per agent hour | `[TO MEASURE]` |
| Cash arrives | Share of delivered COD value matched within 14 days | `[TO MEASURE]` |
| Ads improve | Delivered ROAS before vs after sending delivered events | `[TO MEASURE]` (V2) |

---

## 6. Market sizing (method, no invented numbers)

Do not quote a market size until these inputs are filled from sources (e-commerce reports, courier volume data, storefront platform store counts, interviews).

```
Bottom-up, per country:
  A  = number of online stores in the country with own storefront     [SOURCE NEEDED]
  B  = share of A that sell mainly COD                                 [SOURCE NEEDED]
  C  = share of A×B within 300–20,000 orders/month (the ICP band)       [SOURCE NEEDED]
  SAM (stores)  = A × B × C
  ARPA          = average monthly revenue per account (from pricing mix, section 8)
  SAM (revenue) = SAM (stores) × ARPA × 12
  SOM (year 3)  = SAM (stores) × realistic share [ASSUMPTION, justify with pipeline]
```

Useful sources to fill A–C: storefront platforms' published store counts per country, courier companies' shipment volumes, payment-mix studies for MENA e-commerce, and Brandita's own client data. Record every figure with its source and date in `docs/research/market.md` (create it).

---

## 7. Competition

| Category | Examples | What they do well | Gap Mizan fills |
| --- | --- | --- | --- |
| COD order-management SaaS | Operix (Egypt) and similar regional tools | Order sync, confirmation queue, courier integration, warehouse | No true profit per order, no ad-to-cash attribution, no cash reconciliation, no shared risk network |
| Courier dashboards | Bosta, J&T, Aramex portals | Free with the courier, tracking | Single courier only; no confirmation, no profit, no multi-courier view |
| Storefront built-ins | Shopify, EasyOrders, Salla, Zid admin | Orders and payments in one place | Weak COD workflow, no confirmation, no courier choice, no RTO costing |
| Profit trackers (global) | Shopify profit apps | Profit dashboards | Built for prepaid markets; no COD, RTO, courier cash or Arabic ops |
| Spreadsheets + WhatsApp | Most merchants today | Free, flexible | Error-prone, no history, no scale |

**Why we can win:** Brandita already runs ads for e-commerce brands. Mizan launches with a client base, ad-operations know-how no ops tool has, and a bundle (ads + operating system) competitors cannot match.

**Defensibility over time:** (1) the risk network gets better with every merchant (network effect); (2) connectors that self-heal are expensive to copy; (3) profit and attribution data make switching costly; (4) dialect script library and results.

---

## 8. Pricing and packaging (proposal)

| Plan | Egypt (EGP / month) | GCC (USD / month) | Orders / month | Includes |
| --- | --- | --- | --- | --- |
| **Free** | 0 | 0 | up to 300 | 1 store, 2 users, orders, confirmation, 1 courier |
| **Growth** | 2,500 | 99 | up to 3,000 | 3 stores, 8 users, all couriers, warehouse, **profit engine**, returns |
| **Scale** (the bundle) | 6,500 | 299 | up to 10,000 | Unlimited stores, 25 users, ad attribution, cash reconciliation, CRM, agent commissions |
| **Enterprise** | Custom | Custom | Custom | Multi-country, risk network, SLA, account manager, raised API limits |

| Rule | Proposal |
| --- | --- |
| Overage | Per-order fee above the plan limit; no forced upgrade `[ASSUMPTION: price to test]` |
| Messaging | WhatsApp, SMS and voice billed at cost + margin `[ASSUMPTION: 15–25% margin]`, or the merchant pays Meta directly (Embedded Signup) |
| Annual | 2 months free |
| Brandita bundle | Ad-management clients get Growth or Scale at a discount `[ASSUMPTION: % to set]` |
| Launch offer | First 50 merchants: 3 months free in exchange for a case study |
| Billing currency | EGP for Egypt (local payment methods via Paymob); USD or SAR for GCC |

**Pricing logic:** price by **order volume**, because value (profit protected) grows with orders, and cost to serve grows with orders. Seats and stores are limits that push upgrades but are not the main meter.

**Validation (Discovery):** run a Van Westendorp survey and 15 merchant interviews; test the price as a share of RTO savings ("Mizan costs less than N refused parcels a month").

---

## 9. Unit economics model

The model below is a **template with example assumptions**. Replace every `[ASSUMPTION]` with measured data after the pilot. Keep the live version in a spreadsheet (`docs/finance/` or a Sheets artifact) and update this table from it.

### 9.1 Inputs

| Input | Symbol | Example value | Status |
| --- | --- | --- | --- |
| Average revenue per account per month (blended, after discounts) | ARPA | EGP 3,000 | `[ASSUMPTION]` |
| Hosting + third-party cost per account per month | Cₕ | EGP 250 | `[ASSUMPTION]` |
| Support and success cost per account per month | Cₛ | EGP 350 | `[ASSUMPTION]` |
| Payment processing on subscription | p | 3% of ARPA | `[ASSUMPTION]` |
| Messaging margin per account per month | Mₘ | EGP 150 | `[ASSUMPTION]` |
| Monthly logo churn | c | 3% | `[ASSUMPTION]` |
| Customer acquisition cost (blended) | CAC | EGP 6,000 | `[ASSUMPTION]` |

### 9.2 Formulas

```
Gross margin per account / month  GM  = ARPA × (1 − p) − Cₕ − Cₛ + Mₘ
Gross margin %                         = GM ÷ (ARPA + Mₘ)
Customer lifetime (months)        L   = 1 ÷ c
Lifetime value                    LTV = GM × L
LTV : CAC                              = LTV ÷ CAC        (target ≥ 3)
CAC payback (months)                   = CAC ÷ GM         (target ≤ 12)
```

### 9.3 Worked example (with the example values above)

```
GM       = 3,000 × 0.97 − 250 − 350 + 150 = 2,460 EGP / month
GM %     = 2,460 ÷ 3,150 ≈ 78%
L        = 1 ÷ 0.03 ≈ 33 months
LTV      = 2,460 × 33 ≈ 81,000 EGP
LTV:CAC  ≈ 13.5
Payback  = 6,000 ÷ 2,460 ≈ 2.4 months
```

⚠️ These outputs only show that the model works. They are not a forecast. CAC is low in the example because the first customers come from Brandita's client base; it will rise for cold acquisition.

### 9.4 Merchant ROI (sales argument template)

```
Merchant monthly saving =
    (RTO rate before − RTO rate after) × shipped orders × cost per RTO
  + fake orders blocked × (courier leg + handling)
  + agent hours saved × hourly cost
  + cash recovered from settlement gaps
ROI = saving ÷ Mizan monthly price
```

Fill this for each pilot merchant from their own data; it is the content of every case study.

---

## 10. Revenue plan and milestones

| Phase | Months | Goal | Gate to pass |
| --- | --- | --- | --- |
| Discovery | 0–1 | 15 merchant interviews; price test; API access requests | **Gate 1:** pains and price validated |
| MVP build | 1–4 | M1–M6 + M13 core + M14 basic | **Gate 2:** MVP live with 10 pilot merchants |
| Pilot | 4–6 | 10 Brandita clients; measure RTO and profit; fix and harden | **Gate 3:** RTO drop proven; 30 paying merchants |
| V2 | 6–10 | Attribution + CAPI, cash reconciliation, CRM, commissions, KSA integrations | **Gate 4:** KSA merchants live and retained |
| V3 | 10–15 | Risk network, courier routing, AI analyst, Maghreb and Levant | — |

Revenue targets per gate are set after the pilot baseline: `[TO SET after Gate 2]`.

---

## 11. Go-to-market

1. **Brandita clients first.** Mizan inside existing ad retainers; 10 design partners fast; weekly feedback calls.
2. **Proof in public.** Before-and-after case studies with real RTO and delivered-ROAS numbers, in Arabic and English.
3. **Done-for-you onboarding.** The team connects stores, couriers and WhatsApp for each merchant. Target: first shipped order on day one.
4. **Partnerships.** Listings and co-marketing with Bosta, EasyOrders, Salla, Zid; Shopify App Store listing.
5. **Content and communities.** Arabic content on RTO, COD and real profit; webinars; founder groups in Egypt and KSA.
6. **Country expansion.** KSA with ZATCA, Snap and BNPL; follow Egyptian brands into the GCC.

### Sales motion

| Plan | Motion |
| --- | --- |
| Free | Self-serve signup; in-app upgrade prompts at limits |
| Growth | Inbound + demo; assisted onboarding |
| Scale / bundle | Sold by Brandita account managers with the ad retainer |
| Enterprise | Direct sales; pilot then annual contract |

### Funnel KPIs

Visitor → signup → connected store → first confirmed order → first shipped order → paid. Track each step weekly (see `docs/02-product.md` §Metrics).

---

## 12. Key metrics

**North star:** net profit per delivered order, before vs after Mizan, per merchant.

| Group | Metric | Definition |
| --- | --- | --- |
| Merchant outcome | RTO rate reduction | RTO 60 days before vs after onboarding |
| | Delivered rate | Delivered ÷ shipped |
| | Auto-confirmation share | Confirmed without a human ÷ all confirmed |
| | Cash reconciled in 14 days | Matched settlement ÷ delivered COD value |
| | Delivered ROAS lift | Before vs after sending delivered events |
| Business | MRR, ARPA | Monthly recurring revenue; per account |
| | Weekly active merchants | Owner or ops login in the last 7 days |
| | Time to first value | Signup → first confirmed, shipped order |
| | Free → paid | Paid ÷ free tenants after 60 days |
| | Net revenue retention | Cohort MRR after 12 months ÷ starting MRR |
| | Logo churn | Cancelled ÷ active tenants per month |
| | CAC, payback, LTV:CAC | Section 9 |

---

## 13. Cost structure

### 13.1 Team to build the MVP (7)

| Role | Count | Focus |
| --- | --- | --- |
| Product owner | 1 | Scope, interviews, priorities |
| Product designer | 1 | AR + EN, RTL, dashboard + app |
| Backend engineers | 2 | Services, integrations, events |
| Frontend (Next.js) | 1 | Web dashboard |
| Mobile (Flutter) | 1 | Warehouse and agent app |
| QA and support | 1 | Testing, onboarding, support |

Salary costs: `[TO FILL with Brandita's rates]`. Option to evaluate: in-house vs dev partner (open question).

### 13.2 Running costs (monthly, to fill)

| Item | Driver | Estimate |
| --- | --- | --- |
| Cloud (compute, Postgres, storage, backups) | Tenants, orders | `[TO FILL]` |
| Firebase Auth (phone OTP SMS) | Sign-ins | `[TO FILL]` |
| Google Maps | Address lookups | `[TO FILL]` |
| WhatsApp / SMS / voice | Messages (passed through) | Pass-through |
| LLM provider (V3) | Analyst queries | `[TO FILL]` |
| Error tracking, logs, uptime | Fixed | `[TO FILL]` |
| Email | Volume | `[TO FILL]` |
| Legal and compliance (per country) | One-off + yearly | `[TO FILL]` |

---

## 14. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Courier APIs unstable or undocumented | Broken tracking, bad profit data | Self-healing engine, polling fallback, CSV import |
| WhatsApp template rejections or price rises | Confirmation channel weakens | Customer-initiated chats (free window), BSP backup, voice/SMS fallback, pass costs through |
| Shopify protected-data approval delayed | No customer phone → no confirmation | Apply in Discovery; start pilots on EasyOrders/WooCommerce if needed |
| Competitors copy profit features | Edge shrinks | Move fast on attribution and the risk network (needs scale + agency know-how) |
| Breach or legal challenge to the risk network | Trust and legal exposure | Salted hashes, opt-in, regional storage, legal review per country |
| Scope creep across 14 modules | Late MVP | Strict phase gates; MVP ships 6 modules + automation core |
| Dependence on Brandita clients | Slow growth outside the base | Partnerships and app-store listings from month 4 |
| FX volatility (EGP) | Revenue in USD terms drops | Price GCC in USD; review EGP prices twice a year |

---

## 15. Legal and entity checklist

- [ ] Product and brand name trademark check in EG, KSA, UAE ("Mizan" is a common word; check conflicts).
- [ ] Operating entity: Brandita as owner, or a separate company for Mizan (affects fundraising) — **open question**.
- [ ] Egypt: commercial registration and tax card; data protection under Law 151/2020 (licence / registration with the Personal Data Protection Center when required).
- [ ] KSA: CR and VAT certificate before launch; PDPL compliance; ZATCA Phase 2 for merchants' invoices.
- [ ] Terms of service, privacy policy, data processing agreement (DPA) for merchants, acceptable-use policy.
- [ ] Risk network: separate consent terms; legal review per country before launch.
- [ ] Payments: Mizan never holds merchant money (merchant's own PSP account) — confirm with counsel.
- [ ] Shopify Partner agreement; Meta Tech Provider terms; courier API terms.

---

## 16. Open decisions

| Decision | Options | Owner | Due |
| --- | --- | --- | --- |
| Final name | Mizan or alternative after trademark check | Brandita leadership | Gate 1 |
| Build team | In-house vs dev partner | Brandita leadership | Gate 1 |
| Design partners | Which 10 Brandita clients | Product owner | Gate 1 |
| WhatsApp route | Direct Tech Provider vs BSP | Product owner + backend lead | Discovery |
| Funding | Self-funded vs pre-seed | Leadership | Gate 2 |
| Bundle discount | % off for ad clients | Commercial | Gate 1 |
