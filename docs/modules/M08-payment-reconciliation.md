# M8 — Cash and payment reconciliation · تسوية الكاش والمدفوعات

> **Phase:** V2 · **Depends on:** M3 Shipping, M5 Profit, M6 Returns, M15 Payments, M18 Channels  
> **Estimate:** 2 sprints — 1 backend + 1 frontend. Courier file samples needed before sprint 1.

_Every pound and riyal accounted for: courier cash, gateway payouts, BNPL settlements and bank transfers, matched to orders._

## Purpose

Reconciliation matches every expected payment to money that actually arrived. It covers courier COD settlements, payment gateway payouts (cards, wallets, Apple Pay), BNPL settlements (Tabby, Tamara, valU), bank transfers and marketplace payouts. Each payout is split into orders, fees, refunds and chargebacks; anything missing, short or late is flagged, and the real fees flow into the profit engine.

## Users

| User | Uses it to |
| --- | --- |
| Finance | Imports payouts, resolves gaps |
| Owner | Sees money held by couriers, gateways and marketplaces |
| Ops manager | Opens claims with couriers |
| Accountant | Exports matched data |

## Success metrics

| Metric | Definition |
| --- | --- |
| Reconciled in 14 days | Matched ÷ expected value, all sources |
| Money in transit | Collected or captured, not yet paid out |
| Short-paid amount | Paid less than expected |
| Days to payout | Per courier, gateway, BNPL and marketplace |

## Flow — Expected money, actual money, and **every difference explained**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Expect | Each delivered COD order, captured payment, BNPL sale or marketplace order creates an expected amount, minus estimated fees. | Automatic |
| 2 | Import | Courier settlement files or API; gateway, BNPL and marketplace payout reports by API or file; bank statement lines. | Finance / automatic |
| 3 | Match | By tracking number, gateway reference, order number, then amount and date. | Automatic |
| 4 | ⭐ Flag | Missing, short-paid, overpaid, overdue; refunds and chargebacks deducted from payouts. | Automatic |
| 5 | Resolve | Open a claim or accept the difference as a fee. | Finance |
| 6 | Post | Actual fees replace estimates in M5; export to M19. | Automatic |

- **Column mapping.** Each courier's file layout is mapped once; later files import with one click.
- **Fees become actual.** The difference between expected and paid often is a fee. Mizan records it as the real fee on that order.
- **Ageing.** Cash held over the merchant's limit (for example 10 days) is flagged per courier.

## Main screen — Reconciliation

Filters: `All sources` · `Couriers` · `Gateways` · `BNPL` · `Marketplaces` · `Unmatched · 37`  
Actions: Import payout, Upload file

| Reference | Source | Expected | Paid | Difference | Status |
| --- | --- | --- | --- | --- | --- |
| BOS-77118802 | Bosta | 1,150 | 1,150 | — | Matched |
| PMB-55120931 | Paymob | 1,450 | 1,405 | − 45 | Fee 3.1% |
| BOS-77118790 | Bosta | 640 | — | − 640 | Missing |
| TBY-90311 | Tabby | SAR 899 | SAR 845 | − 54 | Fee 6% |
| NOON-EG-44120 | Noon | 1,280 | 1,088 | − 192 | Commission |

_Sample data. Full visual in `design/prototype.html`._

## Payout sources

| Source | Arrives as | Match key | Typical deductions |
| --- | --- | --- | --- |
| Courier COD settlement | Bank transfer + Excel/CSV or API | Tracking number | Shipping, COD fee, return legs |
| Card / wallet gateway (Paymob, Kashier, Moyasar, Tap, HyperPay, Checkout.com, Stripe) | Payout + transaction report (API or file) | Gateway transaction ID | % + fixed fee, refunds, chargebacks, reserves |
| BNPL (Tabby, Tamara, valU) | Settlement report | Provider order ID | Merchant fee, refunds |
| Bank transfer / InstaPay | Bank statement line | Reference or amount + date + name | Bank fee |
| Marketplace (Amazon, Noon, Jumia) | Payout report | Marketplace order ID | Commission, fulfilment, ads, refunds |

Each source has a column mapping learned once. Unmatched lines stay visible until resolved.

## Rules — Matching rules, in order

| Step | Match on | Result |
| --- | --- | --- |
| 1 | Tracking number, exact | Matched |
| 2 | Order number in settlement reference | Matched |
| 3 | Amount + delivery date ± 2 days, one candidate | Suggested, needs approval |
| 4 | Paid less than expected | Short-paid; fee or claim |
| 5 | Expected, not in any settlement past limit | Overdue |
| 6 | In settlement, no order found | Unknown line; review |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Overdue after | 10 days |
| Auto-accept differences | Under EGP 5 |
| Fee handling | Difference = actual fee |
| File formats | XLSX, CSV, API |
| Claim reminder | Every 3 days |

> Suggested matches are never applied silently. A person approves anything that is not an exact tracking or order-number match.

## Events emitted

| Event | Meaning |
| --- | --- |
| `settlement.imported` | A settlement file was processed |
| `cash.overdue` | Expected cash past the limit |
| `cash.short_paid` | Paid less than expected |
| `claim.opened` | Claim raised with a courier |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `claim.open` | Open a courier claim |
| `report.cash_digest` | Send cash-in-transit summary |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Full | Partial | — |
| Agent | — | — | — |
| Warehouse | — | — | — |
| Finance | Full | Full | Full |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Same settlement uploaded twice | Detected by file hash; ignored |
| Courier changes file layout | Import paused; mapping update requested |
| One payment covers two settlements | Split manually, both linked |
| Order returned after payment | Negative line expected in next settlement |
| Partial delivery | Expected amount = delivered items only |
| Currency mismatch | Rejected; needs manual review |

## Acceptance criteria

- [ ] Every delivered COD order is marked paid, short, missing or overdue.
- [ ] Re-uploading a file creates no duplicates.
- [ ] Actual fees replace estimates in M5.
- [ ] Overdue cash is shown per courier and age.
- [ ] Matched data exports to CSV for accounting.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/settlements/upload` | Upload a settlement file |
| GET | `/v1/settlements/{id}` | Lines and match status |
| POST | `/v1/settlements/{id}/approve` | Approve suggested matches |
| GET | `/v1/cash/in-transit` | Cash held by courier |
| POST | `/v1/claims` | Open a courier claim |
| GET | `/v1/cash/export` | Accounting export |

Conventions: `docs/05-api.md`.

## Entities

`Settlement`, `SettlementLine`, `ExpectedCash`, `Claim`, `FileMapping` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Which couriers offer settlement APIs?
- Bank deposit matching too, or courier files only?
- Who approves accepting a short payment?
