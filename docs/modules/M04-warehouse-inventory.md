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
| ✅ POST | `/v1/picklists` | Create a pick list from the confirmed orders ready to pack; items sorted by shelf (E8-4c) |
| ✅ GET | `/v1/picklists`, `/v1/picklists/{id}` | Open or closed lists; a list with what is left to pick and each order's lines to scan (E8-4c) |
| ✅ POST | `/v1/picklists/{id}/close` | Close by hand; it also closes itself when every order is packed (E8-4c) |
| GET | `/v1/stock/ledger` | Movement history |
| ✅ GET | `/v1/stock` | On hand, reserved, available per item; counted / not counted / out filters (E8-2) |
| ✅ POST | `/v1/stock/movements` | Receive, count, adjust with a reason; all or none (E8-2) |
| ✅ GET | `/v1/stock/{variantId}/movements` | The item's ledger (E8-2) |
| ✅ POST | `/v1/ops/sync` | The ops app's offline queue: receive, count, adjust by scan or SKU, each op once (E8-3) |
| ✅ GET | `/v1/products` | Products and variants with cost, barcode, stock; search and "missing cost / barcode" filters (E8-1) |
| ✅ PATCH | `/v1/products/variants/{id}` | Cost and barcode (E8-1); threshold with E8-5 |
| ✅ POST | `/v1/products/costs/import` | Costs and barcodes from a sheet, all lines or none (E8-1) |

Conventions: `docs/05-api.md`.

## How stock works today (E8-2)

- **Counted or not.** An item is counted by Mizan once it is received or counted on the Stock screen. Until then the store's number is shown and orders don't reserve it (`untracked`).
- **Orders hold stock.** Confirmed → reserve; cancelled or back to waiting → release; shipped, delivered or returned → release and pick (leaves on hand). Lines that change (an accepted offer, a store edit) reserve or release the difference. Every event re-reads the order, so repeats change nothing.
- **Oversell blocked.** If any counted item of a confirmed order isn't available, nothing new is reserved for it: the order is `short` (tab "Waiting for stock", event `stock.short`). Stock that arrives, or that another order releases, reserves waiting orders oldest first (25 per change).
- **Never under reserved.** A count or adjustment that would take on hand under what confirmed orders hold is refused (`below_reserved`).
- **Ledger first.** Each change is a `stock_movements` row; the level is updated in the same transaction and equals the sum of its rows (tested).
- **Offline phones (E8-3).** The ops app queues operations with its own `opId` and sends them to `POST /v1/ops/sync` when online. Each runs once in the order it happened; a replay returns the first outcome; a count under what orders hold is a conflict the app shows (server wins).
- **Alerts (E8-5).** Each counted item can have a threshold (`lowStockAt`). `stock.low` fires once when available falls to it or under, `stock.out` when it reaches zero; the Stock screen has a "Low stock" tab. Push notifications come with the ops app.
- **The store's number (E8-5).** Off by default (Settings on the Stock screen, managers only). When on, Mizan owns the stock of counted items: their available count is sent to Shopify on every change, to the location that stocks the item (the first one when several do; one warehouse until E2-7 / multi-location). Uncounted items stay the store's. Mizan's push goes through the outbox and always sends the latest number; Shopify's own sales lower its number until the next change sends Mizan's.
- **WooCommerce stores (E5-7).** The same switch: each WooCommerce variant knows where WooCommerce keeps its count (the product, the variation, or the product for a variation set to share it, `manage_stock: "parent"`); Mizan sets that record's `stock_quantity` (`woocommerce.setStock`, latest count wins), summing the items that share one count. Products whose stock WooCommerce does not manage, and items not counted in Mizan, are left to the store.
- **Pick and pack (E8-4c, API).** A pick list batches confirmed orders that are ready (stock reserved, not a suspected duplicate, not packed, not on another open list); its items are the totals still to pick, sorted by shelf (`bin`, set per item on the Stock screen's PATCH). The phone sends `order.pack` with every item scanned into the box: packed only when that is exactly the order (a wrong or extra item is `wrong_item`, a missing one `incomplete`), a second phone packing the same order gets `already_packed` (first sync wins), a cancelled one `not_packable`. Packing records `packed_at`, the order's "packed" event and `order.packed`; it does not move stock — stock still leaves when the order ships, so nothing counts twice. A list closes itself when its last order is packed. The phone screens come next (E8-4c app).
- One warehouse for now (the store's default); transfers, pick lists and pack scans are E8-4.

## Field ownership with the store (E8-1)

| Field | Owner | On a store sync |
| --- | --- | --- |
| Title, price, compare-at price, SKU, status | Store | Follows the store; changed in the store |
| Stock (`available`) | Store until the item is counted in Mizan (E8-2) | Shown as "store says"; with "send Mizan's stock to my store" on, Mizan's count goes to Shopify (E8-5) |
| Cost (`cogs_minor`, `cogs_set_at`) | Mizan | Never touched |
| Barcode | Store until set in Mizan (`barcode_set_at`) | Follows the store while the store owns it; left alone once set in Mizan; "use the store's barcode" gives it back |

SKUs and barcodes are unique per store: a store SKU another variant has gets a `SHOPIFY-<id>` stand-in; a store barcode another variant has is not copied (the variant shows "not set").

The products screen (`/products`) lists what is missing (cost, barcode), edits one variant, downloads the list as CSV and imports it back (Arabic or English headers, Shopify's export too).

## Entities

`Warehouse`, `Sku`, `StockLevel`, `StockMovement`, `PickList`, `Scan` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Which phones do warehouse teams use today?
- Bluetooth label printers or office printers?
- Do merchants need batch and expiry tracking (cosmetics)?
