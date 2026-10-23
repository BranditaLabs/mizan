# M5 — Profit engine · محرك الربح

> **Phase:** MVP · the edge · **Depends on:** M1 Orders, M3 Shipping, M6 Returns, M7 Attribution, M8 Cash  
> **Estimate:** 2 sprints — 1 backend + 1 frontend, plus the analytics store for fast dashboards.

_Revenue is a vanity number. Mizan shows what every order really kept._

## Purpose

The profit engine calculates net profit for every order, recomputed whenever something changes: a confirmation, a shipping fee, a refusal, an ad spend import, a settlement. The founder sees real profit for yesterday and the last 30 days the moment they open Mizan.

## Users

| User | Uses it to |
| --- | --- |
| Owner | Real profit today, by product and channel |
| Finance | Costs, fees and margins per order |
| Media buyer | Profit per campaign (with M7) |
| Ops manager | Cost of RTO and confirmation |

## Success metrics

| Metric | Definition |
| --- | --- |
| Net profit per order | The north-star number |
| Contribution margin | Net profit ÷ revenue |
| RTO cost share | Profit lost to refusals |
| Profit by product | Which SKUs actually earn |

## Flow — Every event updates the order's P&L — **no month-end surprise**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Revenue | Order total minus discounts, in the order's currency. | M1 |
| 2 | Product cost | COGS from the SKU's moving-average cost. | M4 |
| 3 | Fulfilment costs | Shipping, COD fee, payment fee, packaging. | M3 · M8 |
| 4 | People cost | Confirmation cost per attempt or agent commission. | M2 · M10 |
| 5 | Ad cost | Campaign spend allocated to its delivered orders. | M7 |
| 6 | ⭐ Net profit | Recomputed on every event; refusals charge full RTO. | Automatic |

- **Event-driven.** Each change publishes an event; the engine recalculates only the affected orders, in seconds.
- **RTO is real cost.** A refused order carries both shipping legs, handling and write-off — it is never just zero.
- **Estimates become actuals.** Fees start as estimates and are replaced by actual amounts when courier settlements arrive.

## Main screen — Profit · last 30 days

Filters: `By order` · `By product` · `By store` · `By courier` · `By country`  
Actions: Export, Set costs

| Order | Revenue | COGS | Ship + COD | Ads | RTO | Net |
| --- | --- | --- | --- | --- | --- | --- |
| #SH-10985 | 1,720 | 690 | 95 | 210 | — | +725 |
| #EO-48101 | 980 | 390 | 130 | 160 | 300 | −1,000 |
| #LF-772 | 890 | 310 | 80 | 140 | — | +360 |
| #WC-3376 | 2,300 | 1,450 | 110 | 260 | — | +480 |
| #EO-48090 | 650 | 230 | 75 | 190 | — | +155 |

_Sample data. Full visual in `design/prototype.html`._

## Profit by payment method

| Method | Revenue recognized | Method-specific costs |
| --- | --- | --- |
| COD | On delivery | Courier COD fee, RTO legs on refusal |
| Card / wallet | On capture | Gateway fee (% + fixed), FX fee, chargebacks + dispute fees |
| BNPL | On capture | BNPL merchant fee (usually higher %), refunds |
| Bank transfer | On match | Bank fee, if any |
| Marketplace | On marketplace confirmation | Commission, fulfilment fees, ad fees (M18) |
| POS | On sale | Card terminal fee (M22) |

Refunds reverse revenue; restocked items reverse COGS; chargebacks add the disputed amount and fees as costs until won. Estimated fees are replaced by actual fees from payouts (M8).

## Rules — How each line of the P&L is calculated

| Line | Formula | Source |
| --- | --- | --- |
| Revenue | Items + shipping charged − discounts | M1 order |
| COGS | Sum of qty × SKU moving-average cost | M4 ledger |
| Fulfilment | Ship fee + COD fee + payment fee + packaging | M3, M8, settings |
| Confirmation | Cost per call / bot message, or commission | M2, M10 |
| Ad cost | Campaign spend ÷ delivered orders of that campaign | M7 |
| RTO | Both shipping legs + handling + damaged write-off | M3, M6 |
| Net profit | Revenue − all the lines above | Engine |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Base currency | Store's country |
| FX source | Daily rate, stored per day |
| Packaging cost | Per order, flat |
| Ad allocation | Delivered orders only |
| Unattributed spend | Shared by revenue |

> Money is stored in minor units with a currency code. FX rates are stored per day, so old orders never change when today's rate does.
>
> ✅ E9-1: costs live in Settings → Costs. Every change is a new version from its day; older orders keep the cost of theirs. Rates come from a daily feed (open.er-api.com first, pluggable), a store can set its own rate for a day, a day without a rate uses the latest within 7 days (marked stale), and beyond that the profit stays provisional.

## Events emitted

| Event | Meaning |
| --- | --- |
| `profit.recalculated` | An order's P&L changed |
| `profit.negative_order` | An order lost money |
| `profit.daily_summary` | Yesterday's totals ready |
| `profit.margin_drop` | Margin fell below the alert level |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `profit.recalculate` | Force recalculation for a range |
| `report.send_summary` | Send the daily profit summary |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Full | — | — |
| Agent | — | — | — |
| Warehouse | — | — | — |
| Finance | Full | Full | Full |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| SKU cost missing | Order flagged 'cost missing'; excluded from margin until set |
| Courier fee unknown at shipping | Estimate used, replaced by actual from settlement |
| Currency change mid-month | Each order keeps its own currency and day rate |
| Partial refund | Revenue reduced by refund; costs stay |
| Ad spend with no orders | Shown as unallocated spend, not hidden |
| Order edited after delivery | P&L recalculated, change logged |

## Acceptance criteria

- [ ] Net profit for yesterday and 30 days is on the home screen.
- [ ] Every number drills down to the orders behind it.
- [ ] A refused order shows its full RTO cost.
- [ ] Recalculation finishes within 1 minute of an event.
- [ ] Estimated fees are visibly marked until actual.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/profit/summary` | Totals for a period and grouping |
| GET | `/v1/orders/{id}/pnl` | ✅ E9-2: one order's P&L lines, expected profit, missing inputs |
| GET | `/v1/profit/by/{dimension}` | Product, store, courier, country |
| GET / POST / DELETE | `/v1/cost-rules` | ✅ E9-1: packaging, agent, COD %, payment fees, courier rate card, monthly costs; versioned |
| GET / PUT | `/v1/fx-rates` | ✅ E9-1: daily rates, store's own rate for a day |
| GET / PUT / DELETE | `/v1/ad-spend`, `POST /v1/ad-spend/import` | ✅ E9-3: a day's ad spend per store and platform, typed or CSV; split over that day's orders |
| POST | `/v1/profit/recalculate` | ✅ E9-2: recalculate provisional orders in a range |
| GET | `/v1/profit/export` | CSV for accounting |

Conventions: `docs/05-api.md`.

## Entities

`OrderPnL`, `CostLine`, `FxRate`, `CostSetting` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Include VAT in revenue or report it separately?
- Which accounting export first: CSV, Zoho or Odoo?
- Allocate unattributed ad spend, or only show it? *MVP (E9-3):* a store's day of spend is split over the orders it took that day; a day with no orders is shown as unallocated, never hidden. Per-campaign attribution comes with M7.
