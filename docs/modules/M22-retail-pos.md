# M22 — Retail POS · نقاط البيع للمحلات

> **Phase:** V3 · **Depends on:** M4 Warehouse, M9 CRM, M15 Payments, M19 Finance  
> **Estimate:** 4 sprints — Flutter POS reusing the ops app's offline layer.

_Sell in your shop or pop-up with the same stock, customers and profit as online._

## Purpose

POS lets brands with a shop, kiosk or pop-up sell from a tablet or phone using Mizan's catalog and stock. Sales, returns and customers are shared with online, so stock is one number, loyalty works everywhere, and profit includes in-store sales.

## Users

| User | Uses it to |
| --- | --- |
| Cashier | Sells and returns |
| Store manager | Shifts, cash drawer |
| Owner | Store performance |

## Success metrics

| Metric | Definition |
| --- | --- |
| Store revenue and profit | Per location |
| Basket size | Items per sale |
| Cash variance | Drawer counted vs expected |
| Sales per hour | Peak-hour staffing |

## Flow — Scan, pay, done, **and the website already knows**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Open shift | Cashier opens drawer with float. | Cashier |
| 2 | Sell | Scan or search; customer by phone; loyalty applied. | Cashier |
| 3 | ⭐ Pay | Cash, card terminal, wallet QR, store credit, split. | Cashier |
| 4 | Receipt | Printed, WhatsApp or email; e-receipt where required. | Automatic |
| 5 | Close shift | Count cash; variance recorded. | Store manager |

- **Offline.** Sales continue offline and sync exactly once.
- **Buy online, return in store.** Returns accepted across channels.
- **Each shop is a warehouse.** Stock per location in M4.

## Main screen — POS · Zamalek shop

Filters: `Sale` · `Returns` · `Shift`  
Actions: Hold sale, Pay

| Item | Qty | Price | Total |
| --- | --- | --- | --- |
| Linen shirt · M | 1 | EGP 1,150 | EGP 1,150 |
| Tote bag | 2 | EGP 250 | EGP 500 |

_Sample data. Full visual in `design/prototype.html`._

## Rules — Payments at POS

| Method | How | Note |
| --- | --- | --- |
| Cash | Drawer | Counted at close |
| Card | Merchant's terminal (Paymob, Geidea …) | Amount entered or integrated |
| Wallet / QR | Payment link QR | M15 |
| Store credit | From M9 wallet | — |
| BNPL in store | Provider QR or link (Tabby, valU) | Where the provider supports it |
| Split payment | Any mix of the above | Ledger lines per method |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Receipt | WhatsApp + print |
| Offline mode | On |
| Discount limit for cashiers | 10% |
| Manager approval | Refunds and discounts above limit |
| Receipt language | Customer's language |

> E-receipt obligations (e.g. Egypt ETA) apply to in-store sales; confirm per merchant.

## Events emitted

| Event | Meaning |
| --- | --- |
| `pos.sale` | Sale completed |
| `pos.shift_closed` | Shift closed with variance |
| `pos.return` | In-store return or exchange |
| `pos.offline_synced` | Offline sales synced |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `pos.print_receipt` | Reprint a receipt |
| `pos.open_drawer` | Open the cash drawer (audited) |
| `pos.apply_loyalty` | Apply points or store credit |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Full | Full | Partial |
| Agent | Partial | Full | — |
| Warehouse | Partial | Full | — |
| Finance | Full | — | — |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Terminal offline | Record card sale manually; reconcile later |
| Stock sold offline twice | Negative stock flagged on sync |
| Return of an online order in store | Refund to original method via M15 or store credit |
| Cashier discount above limit | Manager PIN required |
| Price changed online during the day | POS picks the new price on next sync |

## Acceptance criteria

- [ ] A POS sale reduces the same stock that online sells from.
- [ ] Offline sales sync once with no duplicates.
- [ ] Shift close shows expected vs counted cash.
- [ ] Loyalty points earned in store show online.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/pos/sales` | Record sale |
| POST | `/v1/pos/shifts` | Open / close shift |
| GET | `/v1/pos/registers` | Registers per location |
| GET | `/v1/pos/sales` | Sales and returns |
| POST | `/v1/pos/returns` | Record a return |

Conventions: `docs/05-api.md`.

## Entities

`Location`, `Register`, `Shift`, `PosSale` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Integrated card terminals in which market first?
- Barcode label printing from POS?
- Multi-location stock transfers from the POS app?
