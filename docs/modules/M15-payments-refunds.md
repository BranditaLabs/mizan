# M15 — Payments and refunds · المدفوعات والاسترداد

> **Phase:** MVP · **Depends on:** M1 Orders, M2 Verification, M8 Reconciliation, M5 Profit  
> **Estimate:** 3 sprints — 1 backend + 1 frontend. Paymob first; each extra gateway about 0.5–1 sprint.

_Every payment method in one place: cash on delivery, cards, wallets, BNPL, bank transfer and deposits._

## Purpose

Payments tracks what each order owes and what was paid, by any method. It reads payment data from storefronts and gateways, sends payment links (full, deposit, or to convert a COD order to prepaid), issues refunds and store credit, records chargebacks, and keeps a payment ledger per order. Mizan never holds money: every gateway is the merchant's own account.

## Users

| User | Uses it to |
| --- | --- |
| Owner | Payment mix, refunds, disputes |
| Ops manager | Sends links, converts COD to prepaid |
| Finance | Ledger, refunds, disputes |
| Agent | Sends a payment link during confirmation |

## Success metrics

| Metric | Definition |
| --- | --- |
| Prepaid share | Prepaid orders ÷ all orders |
| COD-to-prepaid conversion | Links paid ÷ links sent |
| Refund time | Request to refund confirmed |
| Chargeback rate | Chargebacks ÷ card orders |

## Flow — From payment link to payout: **every movement of money** on the order.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Read payment | Method, amount, status and gateway reference from the store or gateway. | Automatic |
| 2 | ⭐ Collect | Payment link for full, deposit or remaining balance; reminders. | Agent / automation |
| 3 | Capture | Authorized payments captured on confirm or ship, per store setting. | Automatic |
| 4 | Track COD | COD amount due set on the shipment; marked collected on delivery. | M3 |
| 5 | Refund | Full, partial or store credit; to the original method where possible. | Finance / ops |
| 6 | Dispute | Chargebacks recorded with evidence pack from order, shipment and chat history. | Finance |

- **Merchant-owned gateways.** Paymob, Kashier, Fawry, Moyasar, Tap, HyperPay, Checkout.com, Stripe and BNPL providers connect to the merchant's own account.
- **Ledger, not a flag.** Each order has payment lines (charge, capture, refund, chargeback, COD collection) that always sum to the balance.
- **Card data never touches Mizan.** Hosted payment pages and links only, so Mizan stays out of PCI DSS card-data scope.

## Main screen — Payments

Filters: `All` · `Unpaid` · `Paid` · `COD due` · `Refunds` · `Disputes`  
Actions: Export, New payment link

| Order | Method | Amount | Paid | Balance | Status | Gateway |
| --- | --- | --- | --- | --- | --- | --- |
| #SH-11021 | Card | EGP 1,450 | EGP 1,450 | 0 | Paid | Paymob |
| #EO-48302 | Deposit + COD | EGP 2,100 | EGP 300 | EGP 1,800 | Partially paid | Kashier |
| #SL-5601 | Tabby | SAR 899 | SAR 899 | 0 | Paid | Tabby |
| #WC-3412 | Bank transfer | EGP 3,200 | 0 | EGP 3,200 | Awaiting transfer | InstaPay |
| #SH-10950 | Card | EGP 780 | EGP 780 | 0 | Chargeback | Paymob |

_Sample data. Full visual in `design/prototype.html`._

✅ Built (E14-6): the screen at `/payments` with views All · Waiting for money · Cash to collect · Paid · Refunds · Disputes, counts on each, the view's sums per currency, and the payment mix on the home screen. Export and payment links come with E14-2.

## Rules — Payment statuses

| Status | Meaning | Next |
| --- | --- | --- |
| unpaid | Nothing paid yet (COD before delivery, link not paid) | paid / partially_paid / voided |
| authorized | Card authorized, not captured | paid / voided |
| partially_paid | Deposit or part paid; balance due | paid / refunded |
| paid | Balance is zero | partially_refunded / refunded / disputed |
| refunded | All money returned | — |
| disputed | Chargeback open | paid (won) / refunded (lost) |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Capture | On confirm (card), immediate (wallet) |
| Deposit for risky COD | Off · suggest 10–20% above score 60 |
| Link expiry | 24 hours |
| Refund approval | Finance or owner above a set amount |
| Store credit expiry | 12 months |

> Refunds above the approval threshold and every chargeback response need finance or owner rights. Every refund is written to the audit log.

## Events emitted

| Event | Meaning |
| --- | --- |
| `payment.link_sent` | A payment link was sent |
| `payment.received` | Money captured or COD collected |
| `payment.failed` | A payment attempt failed |
| `refund.created` | Refund requested |
| `refund.completed` | Gateway confirmed the refund |
| `dispute.opened` | Chargeback received |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `payment.send_link` | Send a full, deposit or balance link |
| `payment.capture` | Capture an authorized payment |
| `refund.create` | Refund to method or store credit |
| `order.convert_to_prepaid` | Switch a COD order to prepaid with a link |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Full | Partial | — |
| Agent | Partial | Partial | — |
| Warehouse | — | — | — |
| Finance | Full | Full | Full |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Customer pays twice | Second payment flagged; refund suggested |
| Link paid after COD shipment booked | COD amount updated with courier or flagged |
| Gateway webhook missing | Status poll every 10 min for open payments |
| Partial refund on mixed order | Refund split across payment lines, newest first |
| Chargeback after delivery | Evidence pack: tracking, signature, chat, address |
| Currency differs from base | Ledger in order currency; profit in base currency at daily FX |

## Acceptance criteria

- [x] Every order shows a ledger whose lines sum to its balance. ✅ E14-1: ledger panel on the order screen; property tests in `apps/api/test/ledger.test.ts`.
- [x] A COD order converts to prepaid with one link; the shipment COD amount updates. ✅ E14-3 with manual methods (InstaPay, wallet, transfer, the store's page): the offer and its message from the order screen or the automation action; recording the money lowers the cash to collect and sends a booked shipment to review (docs/12 §5.1). Gateway links with E14-2.
- [ ] Refunds reach the gateway and are confirmed back, or flagged within 24 h.
- [x] Chargebacks appear within one sync and reduce provisional profit. ✅ E14-5: recorded by the team with amount, fee and deadline, in the ledger and profit at once; evidence pack to print as PDF; won puts the amount back. From the gateway's own webhooks with E14-2.
- [ ] No card number is ever stored or logged by Mizan.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/orders/{id}/payments` | Payment ledger ✅ E14-1 |
| POST | `/v1/orders/{id}/payments` | Record money received or given back outside a gateway ✅ E14-1 |
| POST | `/v1/orders/{id}/refunds` · `/v1/refunds/{id}/approve\|reject\|complete` | Refunds with the approval threshold ✅ E14-4 |
| POST | `/v1/orders/{id}/payment-links` | Create a link |
| POST | `/v1/orders/{id}/refunds` | Refund |
| GET | `/v1/payments` | List and filter |
| GET | `/v1/disputes` | Chargebacks ✅ E14-5 (also POST `/v1/orders/{id}/disputes`, GET `/v1/disputes/{id}/evidence`, POST `/v1/disputes/{id}/close`; docs/05) |
| POST | `/v1/disputes/{id}/evidence` | Submit evidence ✅ E14-5 |

Conventions: `docs/05-api.md`.

## Entities

`Payment`, `PaymentLink`, `Refund`, `Dispute`, `StoreCredit` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Which gateways besides Paymob at launch (Kashier, Fawry, Moyasar)?
- Store credit in MVP or V2?
- Capture on confirm or on ship by default?
