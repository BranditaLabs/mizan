# M16 — Purchasing and suppliers · المشتريات والموردين

> **Phase:** V2 · **Depends on:** M4 Warehouse, M5 Profit, M19 Finance  
> **Estimate:** 3 sprints — 1 backend + 1 frontend + Flutter receiving screens.

_Reorder before you run out, receive what you paid for, and know the true landed cost of every unit._

## Purpose

Purchasing manages suppliers, purchase orders, receiving and landed cost. It suggests what to reorder from sales velocity and lead times, sends POs to suppliers, receives stock against them with the ops app, and spreads freight, customs and fees across units so COGS in the profit engine is the real cost.

## Users

| User | Uses it to |
| --- | --- |
| Owner | Approves POs, sees spend |
| Ops manager | Plans reorders |
| Warehouse | Receives and counts |
| Finance | Supplier bills and payments |

## Success metrics

| Metric | Definition |
| --- | --- |
| Stock-out days | Days a best-seller had zero available |
| Days of cover | Available ÷ daily sales |
| Supplier on-time rate | POs received by expected date |
| Landed cost accuracy | Estimated vs actual |

## Flow — From reorder suggestion to received stock **at its real cost**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Suggest | Reorder list from velocity, lead time, safety stock and open POs. | Automatic |
| 2 | Draft PO | Supplier, items, quantities, prices, currency, expected date. | Ops manager |
| 3 | Approve and send | Approval by amount; PDF/email/WhatsApp to supplier. | Owner |
| 4 | Receive | Scan against the PO in the ops app; partial receipts allowed. | Warehouse |
| 5 | ⭐ Landed cost | Freight, customs, fees spread by value, weight or quantity. | Finance |
| 6 | Bill and pay | Supplier bill matched to PO and receipt (3-way match). | Finance |

- **Moving-average cost.** Each receipt updates the SKU's moving-average cost used by M5.
- **Multi-currency.** POs in supplier currency (USD, CNY …); landed cost in base currency at receipt FX.
- **Works offline.** Receiving uses the same exactly-once offline queue as packing.

## Main screen — Purchase orders

Filters: `Draft` · `Sent` · `Partially received` · `Received` · `Billed`  
Actions: Reorder suggestions, New PO

| PO | Supplier | Items | Total | Expected | Received | Status |
| --- | --- | --- | --- | --- | --- | --- |
| PO-0142 | Alex Textiles | 6 SKUs · 900 u | EGP 81,000 | 28 Oct | 0% | Sent |
| PO-0141 | Shenzhen Pack Co. | 3 SKUs · 5,000 u | USD 2,450 | 12 Nov | 40% | Partially received |
| PO-0139 | Cairo Print | 2 SKUs · 2,000 u | EGP 14,000 | 18 Oct | 100% | Received |

_Sample data. Full visual in `design/prototype.html`._

## Rules — Reorder rule

| Input | Default | Note |
| --- | --- | --- |
| Sales velocity | Last 28 days, delivered + paid | Excludes refused and refunded |
| Lead time | Per supplier | Learned from past POs |
| Safety stock | 7 days of cover | Per SKU override |
| Reorder point | velocity × (lead time + safety) | — |
| Order quantity | Up to target cover, rounded to MOQ / pack size | — |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Approval threshold | Owner above EGP 50,000 |
| Landed cost split | By value |
| Target cover | 30 days |
| Supplier portal | Off (V3) |
| Reorder suggestions | Daily at 08:00 |

> Reorder suggestions never send POs automatically unless an automation is published to do so.

## Events emitted

| Event | Meaning |
| --- | --- |
| `po.approved` | PO approved |
| `po.received` | Stock received against a PO |
| `stock.reorder_suggested` | SKU crossed its reorder point |
| `supplier.late` | PO past expected date |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `po.create_draft` | Draft a PO from suggestions |
| `po.send` | Send to supplier |
| `supplier.message` | Send PO or reminder by email or WhatsApp |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Full | Full | Partial |
| Agent | — | — | — |
| Warehouse | Partial | Partial | — |
| Finance | Full | Partial | — |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Supplier sends more than ordered | Over-receipt needs approval |
| Damaged on arrival | Received as damaged; claim opened |
| Price changed on bill | Variance flagged in 3-way match |
| PO in foreign currency | FX locked at receipt for landed cost |
| Supplier lead time slips | Lead time re-learned; reorder points move earlier |
| SKU discontinued | Excluded from suggestions; open POs flagged |

## Built so far (M16-1)

- **Suppliers:** name unique among active ones, currency, contact, lead time, terms, notes; archive and restore.
- **POs:** `PO-0001…`, priced per unit in the supplier's currency (or another); a draft is edited as a whole; approval by amount (owner or admin above the threshold or in a foreign currency, else also the ops manager); "sent" is marked by hand for now; cancel only before anything arrived; late = expected date passed and not fully received.
- **Receiving:** from the web or the ops app (`po.receive`, exactly once per opId), by scan (barcode), SKU or id; good units into stock against the PO (orders waiting for stock get reserved), damaged recorded only; partial receipts; more than ordered needs a manager (the app gets a conflict).
- **Moving-average cost:** per receipt, (on hand × cost + received value) ÷ (on hand + received), in the item's currency at the receipt day's FX rate, locked on the receipt. An item without a cost takes the receipt's. No rate for the day: the stock goes in and the receipt is marked `fx_missing` (cost unchanged).
- **Landed cost (M16-4a):** freight, customs, insurance, clearance and other costs on an open PO, in any currency, spread by value or quantity into the unit cost of each later receipt at its day's rate; the PO screen shows each line's cost with landed costs. A draft PO can be edited from the web.
- **Reorder suggestions (M16-4b):** the rule above on every counted item (sales = shipped less restocked returns; pack size rounding); Purchasing → Reorder groups them by supplier and makes a draft PO at the last price; `stock.reorder_suggested` hourly, once per crossing; the rule's days in Settings → Purchasing.
- **Later:** sending the PO (PDF, email, WhatsApp), supplier bills and the 3-way match, damaged claims, `supplier.late`, ✅ the ops-app receiving screen (M16-3: Receive tab, offline, scan-checked, damaged switch). ✅ Web screens (M16-2): `/purchasing`, `/purchasing/new`, `/purchasing/{id}`, `/purchasing/suppliers`, `/settings/purchasing`.

## Acceptance criteria

- [x] Reorder list matches the rule for every SKU with stock history. ✅ M16-4b (property-tested)
- [x] Receiving updates stock and moving-average cost once, even offline. ✅ M16-1 (API; ops-app screen M16-3)
- [x] Landed cost flows into COGS for orders after receipt. ✅ M16-4a
- [ ] Over-receipts and price variances need approval. ✅ over-receipts (M16-1); price variances with supplier bills
- [x] Every PO line shows its landed cost per unit. ✅ M16-4a (estimated on the PO when the costs share its currency; exact per receipt)

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET · POST · PATCH | `/v1/suppliers` | ✅ Suppliers |
| GET · POST · PUT | `/v1/purchase-orders` | ✅ POs, drafts edited as a whole |
| POST | `/v1/purchase-orders/{id}/approve` · `/send` · `/cancel` | ✅ Lifecycle |
| POST | `/v1/purchase-orders/{id}/receipts` | ✅ Receive (web); the ops app sends `po.receive` through `/v1/ops/sync` |
| GET · PUT | `/v1/settings/purchasing` | ✅ Approval threshold |
| GET | `/v1/reorder-suggestions` | Suggestions |

Conventions: `docs/05-api.md`.

## Entities

`Supplier`, `PurchaseOrder`, `PurchaseOrderLine`, `Receipt`, `LandedCost`, `SupplierBill` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Supplier portal (suppliers confirm POs themselves)?
- Bundles and kits (BOM) in V2?
- Pay suppliers from Mizan, or record payments only?
