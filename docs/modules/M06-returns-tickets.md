# M6 — Returns, exchanges and tickets · المرتجعات والاستبدال والتذاكر

> **Phase:** MVP · **Depends on:** M1 Orders, M3 Shipping, M4 Warehouse, M5 Profit  
> **Estimate:** 2 sprints — 1 backend + 1 frontend, plus inspection screens in the M4 Flutter app.

_Every complaint, exchange and refused parcel is tracked to its cost — and closed._

## Purpose

Returns and Tickets handles everything after the parcel leaves: customer complaints, exchanges, refunds, refused deliveries and open-box inspections. Every case ends in one of three places — restocked, written off, or refunded — and its cost lands on the order's P&L.

## Users

| User | Uses it to |
| --- | --- |
| Support agent | Opens and resolves tickets |
| Warehouse | Inspects returns, restocks or writes off |
| Ops manager | Watches SLAs and return reasons |
| Finance | Approves refunds |

## Success metrics

| Metric | Definition |
| --- | --- |
| Return rate | Returned ÷ delivered, by product |
| Time to resolve | Ticket opened to closed |
| Restock rate | Returns sold again |
| Return reasons | Size, damage, changed mind, wrong item |

## Flow — Open, decide, move the goods, **cost it**, close.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Case opens | From a customer message, agent, or a courier refusal in M3. | Auto / agent |
| 2 | Classify | Complaint, exchange, refund or delivery issue, with a reason code. | Agent |
| 3 | Decide | Approve exchange or refund within the merchant's policy. | Agent / finance |
| 4 | Move the goods | Return pickup booked; exchange ships a linked replacement order. | M3 |
| 5 | ⭐ Inspect | Warehouse scans the item: restock, damaged, or write-off. | Warehouse |
| 6 | Close and cost | Refund paid, stock updated, cost posted to M5. | Automatic |

- **Linked orders.** An exchange creates a new order linked to the original, so both sides of the swap stay visible.
- **Open-box (المعاينة).** Customers who inspect and refuse at the door are recorded with a reason, not lost as plain RTO.
- **Policy in settings.** Return windows and who can approve refunds are set per merchant, then enforced.

## Main screen — Tickets and returns

Filters: `Open · 46` · `Awaiting return · 19` · `Inspect · 8` · `Refund pending · 6` · `Closed · 912`  
Actions: New ticket

| Ticket | Order | Type | Reason | Status | SLA |
| --- | --- | --- | --- | --- | --- |
| T-2210 | #SH-10971 | Exchange | Wrong size | Awaiting return | Due 1 d |
| T-2209 | #EO-48101 | Refused | Open-box · changed mind | Inspect | Due 4 h |
| T-2207 | #WC-3376 | Complaint | Late delivery | Resolved | Met |
| T-2204 | #LF-760 | Refund | Damaged item | Refund pending | Late 2 h |
| T-2201 | #SL-5502 | Exchange | Colour | Replacement shipped | Met |

_Sample data. Full visual in `design/prototype.html`._

## Refunds and exchanges by payment method

Every return or exchange settles money through M15. The ticket stays open until the refund is confirmed back by the provider.

| Paid with | Refund goes | Exchange price difference |
| --- | --- | --- |
| Card, wallet, Apple Pay | Back to the original method through the gateway | Payment link, or partial refund |
| BNPL | Through the BNPL provider (instalments adjusted) | New BNPL checkout or link |
| Bank transfer / InstaPay | Bank transfer back, or store credit | Link or transfer |
| Cash on delivery (delivered) | Store credit, wallet or bank transfer | Collected by courier on the exchange leg |
| Refused at the door (COD) | No refund: nothing was paid | — |

## Rules — Inspection outcomes and their effect

| Outcome | Stock | Money | Profit (M5) |
| --- | --- | --- | --- |
| Restock | + qty sellable | Refund if requested | Shipping legs + handling |
| Damaged, sell as B-grade | + qty B-grade SKU | Partial refund | Value loss + shipping |
| Write-off | No stock added | Refund if requested | Full product cost lost |
| Courier damaged it | Write-off | Claim opened in M8 | Cost until claim paid |
| Exchange | Return + replacement | Price difference only | Both orders' shipping |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Return window | 14 days |
| Refund approval | Finance over EGP 1,000 |
| Exchange shipping | Merchant pays |
| Ticket SLA | 24 hours |
| Open-box allowed | Yes |

> Reason codes are fixed lists, so return reasons can be reported by product and fed back to the merchant's buying decisions.

## Events emitted

| Event | Meaning |
| --- | --- |
| `ticket.created` | New ticket from any channel |
| `ticket.sla_breached` | Not resolved within SLA |
| `return.received` | Item back in the warehouse |
| `return.inspected` | Outcome recorded |
| `refund.issued` | Refund paid |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `ticket.create` | Open a ticket from an automation |
| `exchange.create` | Create linked replacement |
| `refund.request` | Request a refund for approval |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Full | Full | Full |
| Agent | Partial | Partial | — |
| Warehouse | Full | Partial | — |
| Finance | Full | Full | Partial |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Return never arrives | After 14 days, courier claim opened; ticket escalated |
| Customer wants refund and exchange | One must be chosen; agent records which |
| Replacement out of stock | Offer refund or wait; ticket stays open |
| Item returned to the wrong warehouse | Transfer created automatically |
| Refund to wallet fails | Retried; finance alerted after 2 failures |
| Duplicate ticket from same customer | Merged into the first open ticket |

## Acceptance criteria

- [ ] Every return ends restocked, B-grade or written off.
- [ ] Each return's cost appears on the original order in M5.
- [ ] An exchange always links the two orders both ways.
- [ ] SLA breaches raise an alert and an event.
- [ ] Open-box refusals keep their reason code.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/tickets` | Open a ticket |
| PATCH | `/v1/tickets/{id}` | Status, reason, assignee |
| POST | `/v1/returns/{id}/inspect` | Record inspection outcome |
| POST | `/v1/exchanges` | Create linked replacement order |
| POST | `/v1/refunds` | Request or issue a refund |
| GET | `/v1/returns/reasons` | Reason report by product |

Conventions: `docs/05-api.md`.

## Entities

`Ticket`, `Return`, `Inspection`, `Exchange`, `Refund`, `ReasonCode` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Refunds through which providers per country?
- Do customers open tickets themselves (portal) in MVP?
- B-grade stock: separate SKU or a stock flag?
