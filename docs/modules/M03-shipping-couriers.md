# M3 — Shipping and couriers · الشحن وشركات الشحن

> **Phase:** MVP · **Depends on:** M1 Orders, M4 Warehouse, M8 Cash, M12 Routing  
> **Estimate:** 2 + 1 sprints — Core shipping in 2 sprints, then about 1 sprint per courier adapter.

_Book, label, track and grade every courier from one screen._

## Purpose

Shipping turns a packed order into a courier shipment: it books the pickup, prints a branded label, and tracks the parcel until it is delivered or refused. Each courier's status codes are translated into Mizan's statuses, and every courier gets a scorecard by zone.

## Users

| User | Uses it to |
| --- | --- |
| Ops manager | Books shipments, handles exceptions |
| Warehouse | Prints labels, hands over parcels |
| Owner | Compares couriers by zone |
| Finance | Sees fees per shipment |

## Success metrics

| Metric | Definition |
| --- | --- |
| Delivery rate | Delivered ÷ shipped, per courier |
| RTO rate | Refused or returned ÷ shipped |
| Days to deliver | Shipped to delivered |
| Days to remit | Delivered to cash received |

## Flow — From packed parcel to delivered — **tracked at every step**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Choose courier | Merchant rule or M12 routing picks the courier for the zone. | Ops / M12 |
| 2 | Book shipment | Courier API creates the shipment and returns a tracking number. | Automatic |
| 3 | Print label | Branded A6 or A4 label with barcode, COD amount and logo. | Warehouse |
| 4 | Hand over | Pickup scanned as a batch; manifest generated. | Warehouse |
| 5 | ⭐ Track | Webhooks or polling update status; codes mapped to Mizan. | Automatic |
| 6 | Close | Delivered goes to M8 for cash; refused goes to M6 returns. | Automatic |

- **Adapter per courier.** Each courier is a plug-in adapter: book, label, track, cancel. New couriers do not touch the core.
- **Status mapping.** Dozens of courier codes collapse into the seven Mizan statuses, with the raw code kept.
- **Exceptions first.** Stuck parcels (no update in 48 h) surface at the top of the screen.

## Main screen — Shipments

Filters: `Ready to ship · 64` · `In transit · 512` · `Out for delivery · 88` · `Stuck 48 h · 11` · `Refused · 23`  
Actions: Print manifest, Book selected

| Tracking | Order | Courier | Zone | Status | Last update |
| --- | --- | --- | --- | --- | --- |
| BOS-77120931 | #SH-10992 | Bosta | Giza | In transit | 3 h |
| JT-EG4410022 | #EO-48120 | J&T | Alexandria | Stuck | 52 h |
| BOS-77120874 | #LF-772 | Bosta | Cairo | Out for delivery | 40 min |
| ARX-90011233 | #WC-3376 | Aramex | Mansoura | Delivered | 1 d |
| SMSA-2900114 | #SL-5520 | SMSA | Riyadh | In transit | 5 h |

_Sample data. Full visual in `design/prototype.html`._

## Shipments for every payment method

The amount the courier collects comes from the payment ledger (M15), not from the order total.

| Payment method | Courier collects | Notes |
| --- | --- | --- |
| Cash on delivery | Order total | Open-box (المعاينة) and partial delivery reduce the amount collected |
| Deposit + COD balance | Balance due only | Deposit already captured by the gateway |
| Card, wallet, Apple Pay | Nothing | Shipment booked with COD = 0 |
| BNPL (Tabby, Tamara, valU) | Nothing | Provider pays the merchant |
| Bank transfer | Nothing | Shipped only after the transfer is matched |
| Customer pays online after booking | Updated to 0 | COD amount changed with the courier, or shipment re-booked |

## Rules — Courier status mapping (example)

| Mizan status | Example courier codes | Then |
| --- | --- | --- |
| Shipped | PICKED_UP, RECEIVED_AT_HUB | Track |
| In transit | IN_TRANSIT, HUB_TRANSFER | Track |
| Out for delivery | OFD, WITH_COURIER | Notify customer |
| Delivered | DELIVERED, COLLECTED | M8 cash, M5 profit |
| Refused | REJECTED, CUSTOMER_REFUSED | M6 return |
| Exception | HOLD, ADDRESS_ISSUE, NO_ANSWER | Alert ops |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Default courier | Per zone |
| Label size | A6 |
| Stuck alert | No update 48 h |
| Customer tracking SMS | On |
| Open-box allowed | Per merchant |

> Codes shown are illustrative. Each adapter ships with a mapping table confirmed against that courier's API documentation.

## Built

✅ **E7-1 — booking the courier.** A confirmed order with a delivery address is shipped from the order screen (`POST /v1/orders/{id}/ship`, owner, admin, ops manager, warehouse). The shipment row (`booking = pending`) and the engine job `bosta.ship` are written in one transaction; the job carries ids only and the engine reads the order (address, phone) from the platform when it runs. Bosta is called once per shipment: the shipment id is the courier reference, so a booking whose answer was lost is found and adopted, never made twice. The courier collects `cashToCollect(order)` (0 when prepaid, the balance after a deposit; an unpaid transfer is refused before anything is queued). Booked → tracking number, the order `shipped` with `shipped_at` (stock picks, profit moves to shipped), a Shopify order fulfilled with the number. Refused → `failed` with a reason the screen explains (unknown city, address or phone, payment, the courier key), and the team ships again once fixed. Labels wait for Bosta's AWB endpoint to be confirmed (E7-2); status updates from the courier land with E7-3.

## Events emitted

| Event | Meaning |
| --- | --- |
| `shipment.created` | Courier booked, tracking number issued ✅ E7-1 |
| `shipment.booking_failed` | The courier or the order refused the booking (`code`: city_unknown, address_invalid, payment_blocks …) ✅ E7-1 |
| `shipment.status_changed` | Mapped status changed |
| `shipment.stuck` | No update past the threshold |
| `shipment.delivered` | Final delivered status |
| `shipment.refused` | Customer refused or returned |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `shipment.book` | Book with a given courier |
| `shipment.cancel` | Cancel before pickup |
| `shipment.notify_customer` | Send tracking link |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Full | Full | Full |
| Agent | Partial | — | — |
| Warehouse | Full | Full | — |
| Finance | Full | — | — |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Courier API down at booking | Queued and retried; ops told after 3 failures |
| Unknown status code | Mapped to Exception; logged for the adapter team |
| Parcel lost | Marked Lost after courier confirms; claim opened in M8 |
| Address change after booking | Courier update API if supported, else cancel and rebook |
| Partial delivery | Delivered items charged; rest go to M6 |
| Duplicate tracking number | Rejected; alert to ops |
| Upsell offer still being added (M2, E6-13) | Booking waits while the order's offer is `accepted` or `applying`, so the parcel and the cash to collect include it; a proposed offer is allowed up to 30 minutes after confirmation, then it expires and booking goes ahead |

## Acceptance criteria

- [ ] One click books a shipment and prints a label.
- [ ] Status updates within 30 minutes of the courier's update.
- [ ] Every raw courier code is stored with its mapped status.
- [ ] Stuck parcels appear at the top after the threshold.
- [ ] Courier scorecard shows delivery rate by zone.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/orders/{id}/ship` | Book one order ✅ E7-1 (bulk with the shipping screen, E7-2) |
| POST | `/v1/shipments` | Book one or many shipments |
| GET | `/v1/shipments/{id}/label` | Label PDF |
| GET | `/v1/shipments` | List and filter |
| POST | `/v1/couriers/{code}/webhook` | Inbound courier status |
| DELETE | `/v1/shipments/{id}` | Cancel before pickup |
| GET | `/v1/couriers/scorecard` | Rates by zone |

Conventions: `docs/05-api.md`.

## Entities

`Shipment`, `TrackingEvent`, `CourierAccount`, `StatusMapping`, `Manifest` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Which couriers sign API access first?
- Do we print labels from the browser or a local print agent?
- Customer tracking page under the merchant's subdomain?
