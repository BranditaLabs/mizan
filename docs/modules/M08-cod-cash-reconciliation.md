# M8 — COD cash reconciliation · تسوية الكاش مع شركات الشحن

> **Phase:** V2 · **Depends on:** M3 Shipping, M5 Profit, M6 Returns  
> **Estimate:** 2 sprints — 1 backend + 1 frontend. Courier file samples needed before sprint 1.

_Every pound the courier collected, matched to the order — or flagged._

## Purpose

Couriers collect COD cash and pay merchants later, in batches, often with fees deducted and gaps. Cash reconciliation imports each settlement, matches every line to a delivered order, and flags anything missing, short-paid or overdue. Finance stops reconciling spreadsheets by hand.

## Users

| User | Uses it to |
| --- | --- |
| Finance | Imports settlements, resolves gaps |
| Owner | Sees cash held by each courier |
| Ops manager | Opens claims with couriers |
| Accountant | Exports matched data |

## Success metrics

| Metric | Definition |
| --- | --- |
| Cash reconciled in 14 days | Matched ÷ delivered COD value |
| Cash in transit | Collected but not yet paid |
| Short-paid amount | Paid less than expected |
| Days to remit | Per courier |

## Flow — Expected cash, actual cash, and **every difference explained**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Expect | Each delivered COD order creates an expected amount, minus estimated fees. | Automatic |
| 2 | Import | Settlement file (Excel, CSV) uploaded, or synced by courier API. | Finance |
| 3 | Match | Lines matched by tracking number, then order number, then amount. | Automatic |
| 4 | ⭐ Flag | Missing, short-paid, overpaid or overdue amounts listed. | Automatic |
| 5 | Resolve | Open a claim with the courier or accept the difference. | Finance |
| 6 | Post | Actual fees replace estimates in M5; export to accounting. | Automatic |

- **Column mapping.** Each courier's file layout is mapped once; later files import with one click.
- **Fees become actual.** The difference between expected and paid often is a fee. Mizan records it as the real fee on that order.
- **Ageing.** Cash held over the merchant's limit (for example 10 days) is flagged per courier.

## Main screen — Cash reconciliation

Filters: `Unmatched · 37` · `Short-paid · 12` · `Overdue · 58` · `Matched · 2,904`  
Actions: Upload settlement

| Tracking | Courier | Expected | Paid | Difference | Status |
| --- | --- | --- | --- | --- | --- |
| BOS-77118802 | Bosta | 1,150 | 1,150 | — | Matched |
| JT-EG4409871 | J&T | 980 | 915 | − 65 | Short · fee? |
| BOS-77118790 | Bosta | 640 | — | − 640 | Missing |
| ARX-90011100 | Aramex | 2,300 | 2,300 | — | Matched |
| JT-EG4409850 | J&T | 720 | — | Held 14 d | Overdue |

_Sample data. Full visual in `design/prototype.html`._

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
