# 01 — Business model

> **Status:** v2.0, October 2026. Owner: Brandita (Web Development and E-Commerce Solutions).
> ⚠️ Every price, cost and target here is a **proposal to validate** with pilot merchants. Cells marked `[ASSUMPTION]` or `[TO MEASURE]` must be replaced with real figures before they are used in a pitch or a financial model. No market size figure is stated as fact; section 6 gives the method to calculate one.
>
> **v2 change:** Mizan is positioned as the **complete commerce operating system** for MENA brands — every payment method, every sales channel, with automations across all modules. Cash on delivery is a strength (it is where MENA tools fail most), not the boundary of the product.

---

## 1. One-line summary

**Mizan is the operating system for MENA e-commerce brands: one place to run orders, payments, stock, shipping, purchasing, customer service and finance across every channel — with automations connecting all of it, and real profit on every order.** Sold on its own as a SaaS subscription, and bundled with Brandita's ad management.

العربي: **ميزان هو نظام التشغيل الكامل لبراندات التجارة الإلكترونية في المنطقة: الأوردرات، المدفوعات، المخزون، الشحن، المشتريات، خدمة العملاء والحسابات في مكان واحد، لكل قنوات البيع وكل طرق الدفع، وكل ده بيشتغل مع بعض بالأتمتة، مع الربح الحقيقي لكل أوردر.**

---

## 2. Business model canvas

| Block | Mizan |
| --- | --- |
| **Customer segments** | D2C and multi-channel e-commerce brands in MENA selling about 300 to 50,000 orders a month, by **any payment mix**: COD-heavy (Egypt, Levant, Maghreb), card/wallet/BNPL-heavy (KSA, UAE), or mixed. Launch: Egypt, then KSA and the GCC. Secondary: agencies and fulfilment operators running stores for clients; brands with shops or pop-ups (POS, V3). |
| **Value propositions** | One system instead of 6–10 tools. Real profit per order after every cost (product, ads, shipping, payment and marketplace fees, refunds, returns, team). Automations across every module (no developer). Payments of every kind tracked and reconciled. Fewer refused parcels and fraud losses. Ad spend tied to real money. Arabic-first, dialect-native, built for MENA couriers, gateways and tax rules. |
| **Channels** | Brandita's ad clients (first 10 design partners). Done-for-you onboarding. Shopify App Store, Salla and Zid app stores. Courier and gateway partnerships (Bosta, Paymob first). Arabic content, webinars, founder communities. |
| **Customer relationships** | Assisted onboarding at launch; named success manager on Scale and above; in-app chat in Arabic and English; monthly profit review for bundle clients; agency partner programme (V2). |
| **Revenue streams** | Subscription by order volume (monthly or annual); per-order overage; add-ons (marketplaces, POS registers, extra countries, AI analyst, risk network); messaging pass-through with margin (WhatsApp, SMS, voice); Brandita bundle; Enterprise contracts. Mizan never takes a cut of payments (merchants use their own gateways). |
| **Key resources** | The integration engine (`packages/engine`: self-healing connectors, payment-aware shipping); the profit model; Automation Studio and its recipe library; dialect script library; Brandita's ad-operations know-how and client base; over time, the shared risk network and benchmark data. |
| **Key activities** | Building and maintaining connectors (storefronts, marketplaces, couriers, gateways, BNPL, messaging, ads, accounting, tax); onboarding; support; publishing proof. |
| **Key partners** | Storefronts (Shopify, EasyOrders, LightFunnels, WooCommerce, Salla, Zid, YouCan); marketplaces (Amazon, Noon, Jumia); couriers (Bosta, J&T, Mylerz, Aramex, SMSA, SPL, Aymakan); gateways (Paymob, Kashier, Fawry, Moyasar, Tap, HyperPay, Checkout.com, Stripe); BNPL (Tabby, Tamara, valU); Meta (WhatsApp, ads), TikTok, Snap, Google; accounting tools (Zoho Books, Odoo, Daftra); cloud provider. |
| **Cost structure** | Product and engineering team (largest); cloud hosting; messaging (passed through); third-party APIs (maps, SMS, LLM); support and onboarding; app-store fees; legal, tax and compliance per country. |

---

## 3. The problem we solve

A MENA brand runs its business across a storefront, one or two marketplaces, couriers, a payment gateway or two, a BNPL provider, WhatsApp, ad platforms and spreadsheets. Each tool sees one slice. Nobody sees whether an order made money, and nothing connects the tools, so people do the connecting by hand.

| Leak or pain | What happens | Who it hits most |
| --- | --- | --- |
| No single picture | Orders, stock and money live in 6–10 tools; reports are rebuilt in Excel | Every brand |
| Fake and refused COD orders (RTO) | Two shipping legs paid, product handled twice, nothing collected | COD-heavy markets |
| Payment fees, refunds and chargebacks | Gateway, BNPL and marketplace fees rarely reach the P&L; disputes are lost for lack of evidence | Prepaid-heavy markets |
| Money held by others | Courier cash, gateway payouts, BNPL settlements and marketplace payouts arrive late or short; matched by hand | Everyone |
| Stock-outs and overselling | Stock counted separately per channel; reorders late | Multi-channel brands |
| Manual work | Agents copy-paste between tools; follow-ups depend on memory | Ops teams |
| Ads trained on the wrong signal | Pixels learn from purchases that never pay or are refunded | Anyone running ads |
| Compliance | ZATCA e-invoicing, Egypt e-receipts, data protection | KSA, then Egypt |

---

## 4. Customer segments and ICP

### 4.1 Launch ICP (Egypt)

- D2C brand with its own store; any payment mix, typically COD + cards/wallets.
- **500 to 5,000 orders a month.**
- Storefront: Shopify, WooCommerce, EasyOrders or LightFunnels.
- Spends on Meta or TikTok ads.
- 1 to 3 couriers; 2 to 10 people in ops and confirmation.
- Pain: RTO and fake orders, not knowing real profit, manual work between tools.

### 4.2 Second ICP (KSA and UAE, from V2)

- D2C brand, prepaid-heavy (mada, Apple Pay, cards) with Tabby or Tamara.
- 1,000 to 20,000 orders a month on Salla, Zid or Shopify; often on Noon or Amazon too.
- Pain: payment and BNPL fees, refunds, marketplace fees eating margin, ZATCA e-invoicing, multi-channel stock.

### 4.3 Personas

| Persona | Job to be done | Today's tools | What Mizan gives them |
| --- | --- | --- | --- |
| Founder / owner | Know real profit, grow without chaos | Spreadsheets, gut feel | Profit home screen; business P&L; reports |
| Ops manager | Ship real orders fast, keep stock right | Courier portals, WhatsApp groups | One order queue, verification, one-click shipping, stock and reorders |
| Confirmation / service agent | Confirm orders, answer customers | Phone, WhatsApp, Excel | Queue with scripts; unified inbox with the order in view |
| Warehouse staff | Pack and receive the right items | Paper lists | Scan-to-pack and receiving app that works offline |
| Media buyer | Scale campaigns that bring real money | Ads Manager only | Cost per paid/delivered order, CAPI events |
| Finance / accountant | Match money, close the month, file VAT | Bank statements, Excel | Reconciliation for every source, P&L, VAT, e-invoices, exports |

### 4.4 Segments by region

| Region | Payment mix | Main pain | Mizan's lead feature | Phase |
| --- | --- | --- | --- | --- |
| Egypt | COD-heavy, growing cards, wallets, InstaPay, valU | RTO, courier cash, manual ops | Verification + WhatsApp, COD-to-prepaid conversion, reconciliation, profit | MVP |
| KSA and GCC | Prepaid-heavy: mada, Apple Pay, cards, Tabby, Tamara | Fees, refunds, marketplaces, e-invoicing | Payments and reconciliation, marketplaces, ZATCA, attribution | V2 |
| Maghreb | COD-heavy, French and Darija | Fragmented couriers | Darija/French scripts, courier routing | V3 |
| Levant and Iraq | Near-total COD | Weak addresses | Location pin, agent-led confirmation | V3 |

### 4.5 Who we do not serve (for now)

- Marketplace-only sellers with no own store (served later through M18, not sold to first).
- Stores under about 100 orders a month (Free plan, not sold to).
- Large enterprises needing a full ERP ledger or custom manufacturing (Mizan exports to their ERP).

---

## 5. Value proposition

### 5.1 Positioning

> Other tools run one slice of your business. **Mizan runs all of it — and shows if it made money.**

### 5.2 What Mizan does that no regional competitor does together

1. **One operating system:** orders, payments, shipping, stock, purchasing, returns, service, finance, reports and channels in one product, Arabic-first.
2. **Automation across everything:** any event in any module can trigger actions in any other (Automation Studio + recipe library), no developer needed.
3. **True profit per order:** after product cost, ads, shipping, payment/BNPL/marketplace fees, refunds, chargebacks, returns and team cost.
4. **Every payment method, reconciled:** COD, cards, wallets, BNPL, bank transfer, deposits; courier, gateway, BNPL and marketplace payouts matched to orders.
5. **Ad-to-cash attribution:** ad spend tied to money actually received; real conversion events sent back to the ad platforms.
6. **MENA-native:** dialect scripts, local couriers and gateways, ZATCA and ETA, data hosted in the region.
7. **Network effects later:** shared risk network (opt-in, hashed) and benchmarks.

### 5.3 Proof we must produce (pilot)

| Claim | How we measure | Target |
| --- | --- | --- |
| Profit per order goes up | Net profit ÷ completed orders, before vs after | North-star metric |
| Fewer failed orders | RTO rate (COD) and fraud/chargeback rate (prepaid), 60 days before vs after | `[TO MEASURE]` baseline with 10 pilots |
| Less manual work | Orders per ops hour; share of steps done by automations | `[TO MEASURE]` |
| Money arrives | Share of expected value reconciled within 14 days, all sources | `[TO MEASURE]` |
| More prepaid | Prepaid share; COD-to-prepaid link conversion | `[TO MEASURE]` |
| Ads improve | ROAS on paid/delivered orders before vs after real events | `[TO MEASURE]` (V2) |

---

## 6. Market sizing (method, no invented numbers)

```
Bottom-up, per country:
  A  = online stores in the country with their own storefront                 [SOURCE NEEDED]
  C  = share of A within 300–50,000 orders/month (the ICP band)                [SOURCE NEEDED]
  SAM (stores)  = A × C            (no COD filter: Mizan serves every payment mix)
  ARPA          = average monthly revenue per account (pricing mix, section 8, plus add-ons)
  SAM (revenue) = SAM (stores) × ARPA × 12
  SOM (year 3)  = SAM (stores) × realistic share [ASSUMPTION, justify with pipeline]
```

Sources to fill A and C: storefront platforms' published store counts per country, marketplace seller counts, courier and gateway volume data, Brandita's client data. Record each figure with its source and date in `docs/research/market.md` (create it).

---

## 7. Competition

| Category | Examples | Strong at | Gap Mizan fills |
| --- | --- | --- | --- |
| COD order-management SaaS (regional) | Operix and similar | Order sync, confirmation queue, courier integration, warehouse | No full payments/reconciliation, no purchasing, inbox, finance or marketplaces; no profit per order or cross-module automation |
| Storefront built-ins | Shopify, Salla, Zid, EasyOrders admin | Orders and checkout | One channel only; weak COD, no courier choice, no reconciliation or automations across tools |
| Global inventory / OMS tools | Multi-channel inventory and order apps | Stock sync across channels | Not built for MENA couriers, COD, Arabic, ZATCA; no profit or confirmation |
| Profit trackers (global) | Shopify profit apps | Dashboards | Read-only; prepaid-market assumptions; no operations |
| Helpdesks and WhatsApp tools | Shared inboxes, WhatsApp CRMs | Messaging | Disconnected from orders, payments and stock |
| Accounting tools | Zoho Books, Odoo, Daftra | Ledger, tax | No operations; fed by Mizan |
| Courier dashboards | Bosta, J&T, Aramex portals | Free tracking | Single courier; nothing else |
| Spreadsheets + WhatsApp | Most merchants today | Free, flexible | Error-prone, no history, no scale |

**Why we can win:** Brandita already runs ads for e-commerce brands. Mizan launches with a client base, ad-operations know-how, and a bundle (ads + operating system) competitors cannot match.

**Defensibility:** self-healing connectors are expensive to copy; automations and history make switching costly; the risk network and benchmarks improve with every merchant; dialect and MENA compliance depth.

---

## 8. Pricing and packaging (proposal)

| Plan | Egypt (EGP / month) | GCC (USD / month) | Orders / month | Includes |
| --- | --- | --- | --- | --- |
| **Free** | 0 | 0 | up to 300 | 1 store, 2 users, orders, verification, payments, 1 courier, 3 recipes |
| **Growth** | 2,500 | 99 | up to 3,000 | 3 stores, 8 users, all couriers and gateways, warehouse, returns, **profit engine**, Automation Studio recipes, reports |
| **Scale** (the bundle) | 6,500 | 299 | up to 10,000 | Unlimited stores, 25 users, reconciliation, purchasing, inbox, CRM and loyalty, attribution, custom automations, API and webhooks |
| **Enterprise** | Custom | Custom | Custom | Multi-country, risk network, SLA, account manager, raised API limits, sandbox |

| Add-on / rule | Proposal |
| --- | --- |
| Marketplaces (M18) | Per marketplace per month `[ASSUMPTION]` |
| POS (M22) | Per register per month `[ASSUMPTION]` |
| Finance and e-invoicing (M19) | Included in Scale; add-on for Growth `[ASSUMPTION]` |
| AI analyst (M12) | Usage-based `[ASSUMPTION]` |
| Overage | Per-order fee above plan limit; no forced upgrade `[ASSUMPTION: price to test]` |
| Messaging | WhatsApp, SMS, voice at cost + margin `[ASSUMPTION: 15–25%]`, or merchant pays Meta directly |
| Annual | 2 months free |
| Brandita bundle | Ad clients get Growth or Scale at a discount `[ASSUMPTION: % to set]` |
| Launch offer | First 50 merchants: 3 months free for a case study |
| Billing | EGP for Egypt (Paymob); USD or SAR for GCC |

**Pricing logic:** the main meter is **order volume** (value and cost to serve both grow with orders). Seats, stores and add-ons push upgrades. Mizan does not charge a percentage of payments: merchants keep their own gateways and fees.

**Validation (Discovery):** Van Westendorp survey and 15 interviews; anchor the price against tools replaced (sum of current subscriptions) and against losses avoided.

---

## 9. Unit economics model

Template with example assumptions. Replace every `[ASSUMPTION]` after the pilot; keep the live version in a spreadsheet and update this table from it.

### 9.1 Inputs

| Input | Symbol | Example value | Status |
| --- | --- | --- | --- |
| Average revenue per account per month (blended, incl. add-ons, after discounts) | ARPA | EGP 3,400 | `[ASSUMPTION]` |
| Hosting + third-party cost per account per month | Cₕ | EGP 300 | `[ASSUMPTION]` |
| Support and success cost per account per month | Cₛ | EGP 400 | `[ASSUMPTION]` |
| Payment processing on subscription | p | 3% of ARPA | `[ASSUMPTION]` |
| Messaging margin per account per month | Mₘ | EGP 150 | `[ASSUMPTION]` |
| Monthly logo churn | c | 2.5% | `[ASSUMPTION]` |
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

### 9.3 Worked example (example values only)

```
GM       = 3,400 × 0.97 − 300 − 400 + 150 = 2,748 EGP / month
GM %     = 2,748 ÷ 3,550 ≈ 77%
L        = 1 ÷ 0.025 = 40 months
LTV      = 2,748 × 40 ≈ 110,000 EGP
LTV:CAC  ≈ 18
Payback  = 6,000 ÷ 2,748 ≈ 2.2 months
```

⚠️ These outputs only show that the model works. They are not a forecast. CAC is low in the example because the first customers come from Brandita's client base; it will rise for cold acquisition. A full OS should lower churn versus a single-purpose tool — measure it, do not assume it.

### 9.4 Merchant ROI (sales argument template)

```
Merchant monthly saving =
    tools replaced (sum of subscriptions no longer needed)
  + (RTO rate before − after) × COD orders × cost per RTO
  + (fraud/chargeback losses before − after)
  + fees and payouts recovered (short payments found in reconciliation)
  + COD orders converted to prepaid × (RTO risk avoided + earlier cash)
  + staff hours saved by automations × hourly cost
  + stock-outs avoided × average lost margin
ROI = saving ÷ Mizan monthly price
```

---

## 10. Revenue plan and milestones

| Phase | Months | Goal | Gate to pass |
| --- | --- | --- | --- |
| Discovery | 0–1 | 15 interviews (COD-heavy and prepaid-heavy); price test; API access requests | **Gate 1:** pains and price validated |
| MVP build | 1–5 | Orders, verification, payments, shipping, warehouse, profit, returns, Automation Studio core, basic reports | **Gate 2:** MVP live with 10 pilot merchants |
| Pilot | 5–7 | 10 Brandita clients; measure profit, RTO/fraud, manual work; harden | **Gate 3:** results proven; 30 paying merchants |
| V2 | 7–12 | Reconciliation, purchasing, inbox, CRM and loyalty, attribution, marketplaces, finance, KSA stack, API/webhooks | **Gate 4:** KSA merchants live and retained |
| V3 | 12–18 | Risk network, routing and AI analyst, POS, Maghreb and Levant | — |

The MVP is one month longer than v1 (payments and reports added). Revenue targets per gate: `[TO SET after Gate 2]`.

---

## 11. Go-to-market

1. **Brandita clients first.** Mizan inside existing ad retainers; 10 design partners; weekly feedback.
2. **Lead with the pain, sell the OS.** Egypt: RTO and real profit. KSA: fees, reconciliation and ZATCA. Then expand into the full OS (land and expand by module).
3. **Proof in public.** Before-and-after case studies with real numbers, in Arabic and English.
4. **Done-for-you onboarding.** Stores, couriers, gateways and WhatsApp connected for each merchant; first order shipped on day one.
5. **Partnerships and app stores.** Shopify, Salla and Zid app stores; Bosta and Paymob co-marketing; agency partner programme.
6. **Content and communities.** Arabic content on profit, operations and automation; webinars; founder groups in Egypt and KSA.
7. **Country expansion.** KSA with ZATCA, BNPL and marketplaces; follow Egyptian brands into the GCC.

| Plan | Sales motion |
| --- | --- |
| Free | Self-serve; in-app upgrade prompts at limits |
| Growth | Inbound + demo; assisted onboarding |
| Scale / bundle | Brandita account managers with the ad retainer |
| Enterprise | Direct sales; pilot then annual contract |

---

## 12. Key metrics

**North star:** net profit per completed order (delivered or paid and not refunded), before vs after Mizan, per merchant.

| Group | Metric | Definition |
| --- | --- | --- |
| Merchant outcome | Completed-order rate | Delivered or paid and kept ÷ all orders |
| | RTO rate (COD) / chargeback rate (prepaid) | Before vs after onboarding |
| | Prepaid share | Prepaid orders ÷ all orders |
| | Money reconciled in 14 days | Matched ÷ expected value, all sources |
| | Automation share | Steps done by automations ÷ all steps |
| | ROAS on real money | Before vs after sending real conversion events |
| Business | MRR, ARPA, add-on attach rate | — |
| | Modules adopted per tenant | Active modules ÷ available on plan |
| | Weekly active merchants | Owner or ops login in last 7 days |
| | Time to first value | Signup → first order shipped or paid |
| | Free → paid | Paid ÷ free tenants after 60 days |
| | Net revenue retention | Cohort MRR after 12 months ÷ starting MRR |
| | Logo churn | Cancelled ÷ active tenants per month |
| | CAC, payback, LTV:CAC | Section 9 |

---

## 13. Cost structure

### 13.1 Team to build the MVP (8)

| Role | Count | Focus |
| --- | --- | --- |
| Product owner | 1 | Scope, interviews, priorities |
| Product designer | 1 | AR + EN, RTL, dashboard + app |
| Backend engineers | 3 | Platform, integrations (engine), payments and profit |
| Frontend (Next.js) | 1 | Web dashboard |
| Mobile (Flutter) | 1 | Warehouse, agent and later POS app |
| QA and support | 1 | Testing, onboarding, support |

One more backend engineer than v1, for payments and the wider OS. Salary costs: `[TO FILL with Brandita's rates]`. In-house vs dev partner: open question.

### 13.2 Running costs (monthly, to fill)

| Item | Driver | Estimate |
| --- | --- | --- |
| Cloud (compute, Postgres, storage, backups) | Tenants, orders | `[TO FILL]` |
| Firebase Auth (phone OTP SMS) | Sign-ins | `[TO FILL]` |
| Google Maps | Address lookups | `[TO FILL]` |
| WhatsApp / SMS / voice | Messages (passed through) | Pass-through |
| LLM provider (AI drafts, analyst) | Usage | `[TO FILL]` |
| Error tracking, logs, uptime | Fixed | `[TO FILL]` |
| Email | Volume | `[TO FILL]` |
| Legal, tax and compliance (per country) | One-off + yearly | `[TO FILL]` |

---

## 14. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Scope: a full OS is large | Late MVP, thin modules | Strict phase gates; MVP = 9 modules (core); land with one pain, expand by module |
| Connector breadth (stores, couriers, gateways, marketplaces) | Integration backlog | Self-healing engine, one connector pattern (`/new-connector`), CSV fallbacks |
| Courier and gateway APIs unstable or undocumented | Bad tracking or money data | Polling, reconciliation, drift reports, file import |
| Wrong cash amount on a shipment | Direct money loss | Engine collects only what is owed; unknown payment methods never ship (tested under chaos) |
| WhatsApp template rejections or price rises | Confirmation and service weaken | Customer-initiated chats, BSP backup, SMS/voice fallback, pass costs through |
| Shopify protected-data approval delayed | No customer phone | Apply in Discovery; pilot on EasyOrders/WooCommerce if needed |
| Payments regulation | Licence exposure | Mizan never holds funds; merchant-owned gateways; counsel review |
| Competitors copy features | Edge shrinks | Breadth + automation + data network effects; Brandita bundle |
| Dependence on Brandita clients | Slow growth outside the base | App stores and partnerships from month 5 |
| FX volatility (EGP) | Revenue in USD drops | Price GCC in USD; review EGP prices twice a year |

---

## 15. Legal and entity checklist

- [ ] Product and brand name trademark check in EG, KSA, UAE.
- [ ] Operating entity: Brandita as owner, or a separate company for Mizan — **open question**.
- [ ] Egypt: commercial registration and tax card; data protection under Law 151/2020 (registration or licensing with the data protection authority when required).
- [ ] KSA: CR and VAT certificate before launch; PDPL; ZATCA Phase 2 for merchants' invoices.
- [ ] Terms, privacy policy, data processing agreement (DPA), acceptable-use policy.
- [ ] Payments: Mizan never holds merchant money; card data never touches Mizan (hosted pages) — confirm with counsel.
- [ ] Risk network: separate consent terms; legal review per country.
- [ ] Platform agreements: Shopify Partner, Meta Tech Provider, marketplace developer terms, courier and gateway API terms.

---

## 16. Open decisions

| Decision | Options | Owner | Due |
| --- | --- | --- | --- |
| Final name | Mizan or alternative after trademark check | Brandita leadership | Gate 1 |
| Build team | In-house vs dev partner | Brandita leadership | Gate 1 |
| Design partners | Which 10 Brandita clients (mix of COD-heavy and prepaid-heavy) | Product owner | Gate 1 |
| First gateways after Paymob | Kashier, Fawry, Moyasar, Tap | Product + backend lead | Discovery |
| First marketplace | Noon or Amazon | Product owner | Gate 3 |
| WhatsApp route | Direct Tech Provider vs BSP | Product + backend lead | Discovery |
| Funding | Self-funded vs pre-seed | Leadership | Gate 2 |
| Bundle discount | % off for ad clients | Commercial | Gate 1 |
