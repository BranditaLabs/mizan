# 12 — Payments

How Mizan handles money for every payment method. Modules: M15 (payments and refunds), M8 (reconciliation), M5 (profit), M19 (finance). Engine rules: `packages/engine/src/core/payments.ts`.

> **Principle:** Mizan never holds merchant money and never sees card data. Every gateway, BNPL and bank account belongs to the merchant. Mizan records, requests (links, refunds) and reconciles.

## 1. Payment methods

| Mode (`payment_mode`) | Examples | Paid when | Courier collects | Typical checks |
| --- | --- | --- | --- | --- |
| `cod` | Cash on delivery | On delivery | Amount outstanding (else total) | Confirmation (M2) |
| `partial` | Deposit online + COD balance | Deposit at checkout or link; balance on delivery | Balance only | Light confirmation |
| `prepaid` | Cards, mada, Meeza, wallets (Vodafone Cash …), Apple Pay, gateway checkout | At checkout (capture now or on confirm/ship) | 0 | Fraud screen |
| `bnpl` | Tabby, Tamara, valU, Sympl, Souhoola | At checkout (provider pays merchant) | 0 | Address + stock |
| `bank_transfer` | Bank deposit, InstaPay, Fawry reference | Before shipping | 0 (does not ship until paid) | Payment match |
| `store_credit` | Refund credit, loyalty | At checkout or POS | 0 | — |
| `mixed` | Any combination (e.g. store credit + card) | Per line | Remaining cash part | Per line |
| `unknown` | Unrecognised method | — | **Does not ship** | Ops sets the method |

Detection (Shopify): gateway names in English and Arabic plus `displayFinancialStatus`, `totalReceivedSet`, `totalOutstandingSet`, `totalRefundedSet` (verified in API 2026-10). Patterns are extendable per tenant. Other storefronts must fill the same canonical fields.

## 2. Payment status

| `payment_status` | Meaning | Shopify source |
| --- | --- | --- |
| `unpaid` | Nothing received (COD before delivery, link not paid, transfer pending) | `PENDING` |
| `authorized` | Card authorized, not captured | `AUTHORIZED` |
| `partially_paid` | Deposit or part paid | `PARTIALLY_PAID` |
| `paid` | Fully paid | `PAID` |
| `partially_refunded` / `refunded` | Money returned | `PARTIALLY_REFUNDED` / `REFUNDED` |
| `voided` | Authorization released | `VOIDED` |
| `failed` | Payment expired or failed | `EXPIRED` |
| `disputed` | Chargeback open | From gateway |

## 3. The ledger

Every order has payment lines in `payments` (`packages/db/migrations/0002_commerce_os.sql`): `authorization`, `capture`, `sale`, `cod_collection`, `refund`, `chargeback`, `chargeback_reversal`, `void`. Amounts are signed minor units (in = positive, out = negative). Invariants:

- `orders.paid_minor` = Σ succeeded money-in lines; `orders.refunded_minor` = Σ refunds; `orders.balance_minor` = what the customer still owes (generated column).
- One line per gateway transaction (`UNIQUE (connection_id, external_ref, kind)`), so webhooks and polls never double-count.
- Fees are estimated at capture (`fee_is_actual = false`) and replaced by actual fees from payouts (M8).

## 4. The cash rule (engine)

`cashToCollect(order)` decides what a courier collects, for every courier connector:

| Situation | Result |
| --- | --- |
| `cod` | Outstanding amount, else total − received |
| `partial` | Outstanding, else total − received; blocks if neither is known |
| `prepaid`, `bnpl`, `bank_transfer` paid or authorized | 0 |
| `prepaid`, `bnpl`, `bank_transfer` unpaid | **Blocked:** `awaiting_payment` |
| Payment failed | **Blocked:** `payment_failed` |
| Refunded or voided | **Blocked:** `refunded` |
| `unknown` | **Blocked:** `payment_mode_unknown` |

Blocked orders arriving through auto-ship emit `order.awaiting_payment` and ship automatically when paid; a forced ship dead-letters with the reason. Arithmetic is exact (decimal strings → integer minor units, 3-decimal currencies supported). Tested end to end under 50% provider failure for all methods.

## 5. Flows

### 5.1 COD to prepaid conversion

Risky COD order (M2 score ≥ threshold) → `payment.send_link` (full or deposit, optional discount) → customer pays → `payment.received` → order becomes `prepaid` or `partial` → shipment COD amount updated (or booked with the new amount) → risk reduced. Recipe: *COD rescue* (`docs/13-automation-platform.md`).

### 5.2 Bank transfer

Order placed with bank transfer → held, reminders at 12 h and 36 h → payment matched (merchant marks paid, or bank line matched in M8) → ships automatically → cancelled and stock released after the deadline if unpaid.

### 5.3 Refunds

Return inspected or refund approved → `refund.create` → to original method through the gateway or BNPL provider; or store credit; or bank transfer for COD orders → `refund.completed` on provider confirmation → profit and stock updated. Approval above a threshold (finance or owner). Every refund audited.

### 5.4 Chargebacks

Gateway reports dispute → `dispute.opened` → evidence pack generated (order, shipment tracking and proof of delivery, chat history, address, IP if available) → finance submits before `respond_by` → won (reversal) or lost (cost in M5).

## 6. Fees and profit

| Fee | Source | Lands in `order_pnl` |
| --- | --- | --- |
| Gateway % + fixed | Rate card, then payout | `payment_fee_minor` |
| BNPL merchant fee | Rate card, then settlement | `payment_fee_minor` |
| COD collection fee | Courier rate card, then settlement | `cod_fee_minor` |
| Marketplace commission + fulfilment | Payout report | `channel_fee_minor` |
| Refunds | Ledger | `refund_minor` |
| Chargeback amount + fee | Dispute | `chargeback_minor` |

## 7. Providers by market (confirm API terms before building)

| Market | Gateways | BNPL | Other |
| --- | --- | --- | --- |
| Egypt | Paymob (MVP), Kashier, Fawry, Geidea | valU, Sympl, Souhoola | InstaPay (no confirmed merchant API), wallets via gateways |
| KSA | Moyasar, HyperPay, Tap, Checkout.com, Paymob | Tabby, Tamara | mada, Apple Pay, STC Pay via gateways |
| UAE | Checkout.com, Stripe, Tap, Paymob | Tabby, Tamara, Postpay | Apple Pay via gateways |
| Maghreb, Levant, Iraq | Local gateways `[TO CONFIRM]` | — | COD-first |

Integration pattern per gateway: OAuth or merchant keys in `secrets`; webhook signature verification; payment links API; refunds API; transaction and payout reports (API or file) for M8. Each is an engine connector with a fake and chaos tests (`/new-connector`).

## 8. Compliance

- **PCI DSS:** Mizan uses hosted payment pages and links only; card numbers never enter Mizan systems. Keep it that way (SAQ-A scope for the merchant).
- **No funds held:** Mizan is not a payment facilitator; money goes from provider to merchant. Confirm with counsel per country before adding wallet or payout features.
- **Refund permissions:** role-based, thresholds, audit log.
- **Tax:** refunds create credit notes in M19 where e-invoicing applies (ZATCA, ETA).
