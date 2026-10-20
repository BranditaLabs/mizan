# M4 — Warehouse and inventory · المخزن والمخزون

> **Phase:** MVP · **Depends on:** M1 Orders, M3 Shipping, M6 Returns, M5 Profit  
> **Estimate:** 3 sprints — 1 backend + 1 Flutter engineer. Offline sync is the riskiest part; prototype it first.

_Pack the right item every time, even when the internet drops._

## Purpose

Warehouse keeps stock per SKU across warehouses and runs pick-and-pack on a phone. Staff scan each item with the phone camera; a wrong item blocks the order. The app keeps working offline and syncs when the connection returns.

## Users

| User | Uses it to |
| --- | --- |
| Warehouse staff | Pick, scan, pack, hand over |
| Ops manager | Receives stock, transfers, adjusts |
| Owner | Sees stock value and low-stock alerts |
| Finance | Stock value for the books |

## Success metrics

| Metric | Definition |
| --- | --- |
| Pick accuracy | Orders packed without a wrong item |
| Orders packed per hour | Warehouse throughput |
| Oversells | Orders confirmed with no stock, target zero |
| Stock accuracy | System vs physical count |

## Flow — Reserve, pick, scan, pack — **with or without signal**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Reserve stock | Confirmed orders reserve quantity; available stock drops. | Automatic |
| 2 | Pick list | Orders batched into a pick list sorted by shelf location. | Warehouse |
| 3 | ⭐ Scan items | Phone camera scans each barcode or QR. Wrong SKU blocks. | Warehouse |
| 4 | Pack and label | Scan the box, print the M3 label, mark Packed. | Warehouse |
| 5 | Sync | Offline scans queue on the phone and sync once online. | Automatic |
| 6 | Restock | Returns from M6 come back in after inspection. | Warehouse |

- **Offline-first.** The Flutter app stores pick lists locally. Scans are timestamped and replayed in order, so nothing double-counts.
- **Three numbers.** On hand, reserved and available are always shown, so nobody sells stock already promised.
- **Low-stock alerts.** Each SKU has a threshold; alerts go to ops and can trigger an automation.

## Main screen — Inventory · Main warehouse

Filters: `All SKUs · 312` · `Low stock · 14` · `Out of stock · 3` · `Reserved > 50% · 21`  
Actions: Receive stock, New pick list

| SKU | Product | On hand | Reserved | Available | Location |
| --- | --- | --- | --- | --- | --- |
| SER-30 | Vitamin C serum 30 ml | 420 | 96 | 324 | A-03-2 |
| AFX-XL | Air fryer XL | 18 | 15 | 3 | C-11-1 |
| CRM-50 | Night cream 50 ml | 260 | 40 | 220 | A-04-1 |
| BAG-TT | Tote bag, black | 75 | 12 | 63 | B-02-4 |
| SPF-50 | Sunscreen SPF 50 | 0 | 0 | 0 | A-05-3 |

_Sample data. Full visual in `design/prototype.html`._

## Rules — Stock movements and what they change

| Movement | On hand | Reserved | Recorded with |
| --- | --- | --- | --- |
| Order confirmed | — | + qty | Order ID |
| Order packed | − qty | − qty | Scan, user, time |
| Order cancelled | — | − qty | Order ID |
| Stock received | + qty | — | Supplier, PO, cost |
| Return restocked | + qty | — | M6 inspection |
| Adjustment | ± qty | — | Reason, approver |
| Transfer | − from, + to | — | Both warehouses |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Block oversell | On |
| Low-stock threshold | Per SKU |
| Scan required to pack | On |
| Costing method | Moving average |
| Adjustments need approval | Over 10 units |

> Every movement is an append-only ledger row. Stock levels are a sum of the ledger, so any number can be traced back to who moved what.

## Events emitted

| Event | Meaning |
| --- | --- |
| `stock.low` | Available fell under the threshold |
| `stock.out` | Available hit zero |
| `order.packed` | All items scanned, box packed |
| `stock.adjusted` | Manual adjustment with reason |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `stock.reserve` | Reserve stock for an order |
| `stock.transfer` | Move stock between warehouses |
| `picklist.create` | Create a pick list from orders |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Full | Full | Full |
| Agent | — | — | — |
| Warehouse | Full | Full | — |
| Finance | Full | — | — |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Two phones pack the same order offline | First sync wins; second gets a conflict notice |
| Barcode not readable | Manual SKU entry, logged as manual |
| Stock hits zero mid-confirmation | New confirmations blocked; order flagged |
| Phone offline for a day | Queue replays in order; ops sees a sync report |
| Bundle product | Reserves each component SKU |
| Negative stock found | Blocked; adjustment with reason required |

## Acceptance criteria

- [ ] A wrong-SKU scan blocks packing.
- [ ] Offline scans sync once, with no double counts.
- [ ] Available stock never goes below zero.
- [ ] Every stock number traces back to ledger rows.
- [ ] Pick list sorts items by shelf location.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/stock` | Levels by SKU and warehouse |
| POST | `/v1/stock/movements` | Receive, adjust, transfer |
| POST | `/v1/picklists` | Create a pick list |
| POST | `/v1/scans/batch` | Sync offline scans |
| GET | `/v1/stock/ledger` | Movement history |
| PATCH | `/v1/skus/{id}` | Threshold, cost, barcode |

Conventions: `docs/05-api.md`.

## Entities

`Warehouse`, `Sku`, `StockLevel`, `StockMovement`, `PickList`, `Scan` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Which phones do warehouse teams use today?
- Bluetooth label printers or office printers?
- Do merchants need batch and expiry tracking (cosmetics)?
