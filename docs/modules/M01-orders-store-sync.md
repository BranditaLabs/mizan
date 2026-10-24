# M1 — Orders and store sync · الأوردرات وربط المتاجر

> **Phase:** MVP · **Depends on:** M2 Confirmation, M3 Shipping, M4 Warehouse, M5 Profit  
> **Estimate:** 3 sprints — 2 backend engineers + 1 frontend. Each extra storefront connector adds about 1 sprint.

_Every order from every store lands in one list, in under a minute, with nothing lost and nothing doubled._

## Purpose

Orders Sync pulls orders from each connected storefront the moment they are placed, cleans them (phone format, address, duplicates) and gives the team one list to work from. Everything downstream — confirmation, shipping, profit — starts from this record.

## Users

| User | Uses it to |
| --- | --- |
| Ops manager | Watches the queue, bulk-assigns and ships |
| Agent | Opens orders assigned to them |
| Owner | Sees volume by store and status |
| Warehouse | Sees confirmed orders ready to pack |

## Success metrics

| Metric | Definition |
| --- | --- |
| Sync time | New order visible in Mizan, target under 60 s |
| Duplicate rate | Share of orders merged as duplicates |
| Orders per ops hour | Throughput of the ops team |
| Lost orders | Store orders missing in Mizan, target zero |

## Flow — From checkout to a clean, scored order **in under a minute**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Store sends order | Webhook from the storefront hits Mizan. Polling every 5 min catches anything missed. | Automatic |
| 2 | Normalize | Phone to E.164, governorate and city matched, items mapped to Mizan SKUs. | Automatic |
| 3 | ⭐ Deduplicate | Same phone + same product within 48 h is flagged and merged on approval. | Automatic |
| 4 | Score and route | Order sent to M2 for a risk score and a confirmation route. | M2 |
| 5 | Work the queue | Ops filters, bulk-assigns, prints and ships from one list. | Ops manager |
| 6 | Stay in sync | Status changes push back to the store; cancellations sync both ways. | Automatic |

- **Idempotent.** Every store event carries its external ID, so a webhook received twice never creates two orders.
- **Mapping memory.** A product mapped to a SKU once is mapped automatically next time.
- **Nothing lost.** A nightly reconciliation compares store order counts with Mizan and alerts on any gap.

## Main screen — Orders

✅ Built in E5-1 (`apps/web/src/components/orders/OrdersScreen.tsx`, `GET /v1/orders`): status tabs with counts, search, table, show more. Store column, Duplicates tab, Import CSV and New order come with E5-3, E5-5 and more connectors.

Filters: `All · 1,284` · `New · 96` · `Pending confirmation · 41` · `Confirmed · 212` · `Shipped · 803` · `Duplicates · 7`  
Actions: Import CSV, New order

| Order | Customer | Store | Total | Risk | Status | Age |
| --- | --- | --- | --- | --- | --- | --- |
| #EO-48213 | Mona A. · 010•••4821 | EasyOrders | EGP 1,150 | Medium | Pending | 6 min |
| #SH-10992 | Karim H. · 012•••7730 | Shopify | EGP 640 | Low | Confirmed | 18 min |
| #WC-3381 | Sara M. · 011•••0912 | WooCommerce | EGP 2,300 | High | Pending | 22 min |
| #EO-48209 | Mona A. · 010•••4821 | EasyOrders | EGP 1,150 | Duplicate | Review | 41 min |
| #LF-772 | Youssef K. · 015•••3301 | LightFunnels | EGP 890 | Low | Shipped | 3 h |

_Sample data. Full visual in `design/prototype.html`._

## Order detail

✅ Built in E5-2 (`apps/web/src/components/orders/OrderDetail.tsx`, `GET /v1/orders/{id}`, `POST /v1/orders/{id}/reveal`): header with status and payment, items, money (paid, still owed, cash the courier collects), payments ledger, shipments (from E7), risk and reasons, activity timeline (newest first). The customer card is masked (`Mona A.`, `••• 4821`, area); **Show details** asks the API, which decrypts and writes `customer.pii_viewed` to the audit log, then shows name, phone (`tel:` link), address and a Google Maps link when the order has a pin (filled from WhatsApp location in E6-4). Actions (confirm, assign, cancel, merge) arrive with E5-3, E5-4 and E6.

## Payment methods and channels

Orders arrive with any payment method and from any channel. M1 normalizes both:

| Field | Values |
| --- | --- |
| `payment_mode` | `cod`, `prepaid`, `partial` (deposit + COD balance), `bnpl`, `bank_transfer`, `unknown` |
| `payment_status` | `unpaid`, `authorized`, `paid`, `partially_paid`, `refunded`, `partially_refunded`, `failed`, `voided` |
| `channel` | Own store (Shopify, WooCommerce, EasyOrders, LightFunnels, Salla, Zid, YouCan), marketplace (M18), social and chat orders, manual, POS (M22) |

Downstream modules branch on these: M2 picks confirmation (COD) or fraud screening (prepaid); M15 tracks the money; M5 applies the right fees.

## Rules — Status model and duplicate rules

| Status | Entered when | Next |
| --- | --- | --- |
| New | Order synced and normalized | Pending confirmation |
| Pending confirmation | Routed by M2 to bot, agent or hold | Confirmed, Cancelled |
| Confirmed | Customer or agent confirms | Packed |
| Packed | Warehouse scan completes | Shipped |
| Shipped | Courier shipment created (M3) | Delivered, Refused |
| Delivered / Refused | Courier final status | Closed, Returned |
| Duplicate | Same phone + product within window (✅ E5-3: held from confirmation; `duplicate_status suspected`) | Merged (cancelled, tagged `mizan-duplicate`) or kept (confirmation starts) |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Duplicate window | 48 hours |
| Polling fallback | Every 5 minutes |
| Phone country default | Store's country |
| Auto-merge duplicates | Off · review first |
| Custom statuses | Allowed, mapped to core |

> Merchants can add their own statuses, but each must map to one of the seven core statuses so reports and profit stay correct.

## Events emitted

| Event | Meaning |
| --- | --- |
| `order.created` | A new order was synced and normalized |
| `order.status_changed` | Any status move, with old and new status |
| `order.duplicate_found` | A likely duplicate was detected (✅ E5-3) |
| `order.duplicate_resolved` | The team kept it or merged it (✅ E5-3) |
| `orders.reconciled` | The nightly check fetched orders a lost webhook never brought (✅ E5-8) |
| `orders.reconciliation_gap` | After the nightly check, the store and Mizan still count a day's orders differently (✅ E5-8) |
| `order.cancelled` | Cancelled in Mizan or in the store |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `order.set_status` | Move an order to a status |
| `order.assign` | Assign to an agent or team |
| `order.add_tag` | Tag an order, for example VIP |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Full | Full | Partial |
| Agent | Partial | Partial | — |
| Warehouse | Partial | — | — |
| Finance | Full | — | — |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Webhook arrives twice | Ignored by external ID; no second order |
| Store is down | Polling resumes and backfills when it returns |
| Product not mapped to a SKU | Order held as New with a mapping prompt |
| Phone number invalid | Flagged; M2 routes it to an agent |
| Order edited in the store | Changes synced; activity log records both versions |
| Store disconnected | Owner alerted; orders keep their history |

## Acceptance criteria

- [ ] A new Shopify order appears within 60 seconds with correct items, price and customer.
- [ ] A webhook sent twice creates one order.
- [ ] Nightly reconciliation finds zero missing orders on a test store.
- [ ] Bulk-assign 100 orders completes in under 5 seconds.
- [ ] A cancellation in the store cancels the order in Mizan, and back.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/orders` | List and filter orders |
| GET | `/v1/orders/{id}` | Order with items and history |
| POST | `/v1/orders` | Create a manual order |
| PATCH | `/v1/orders/{id}` | Edit, change status, assign |
| POST | `/v1/orders/bulk` | Bulk assign, tag, status |
| POST | `/v1/stores/{id}/webhook` | Inbound store webhook |

Conventions: `docs/05-api.md`.

## Entities

`Store`, `Order`, `OrderItem`, `Customer`, `SkuMapping`, `OrderEvent` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Which storefronts are in the first release?
- Do merchants need manual orders from day one?
- Keep store order numbers or issue Mizan numbers?
