# ADR-0011: Collect only what is owed; never guess the payment method

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

Mizan serves every payment method (COD, card, wallet, deposit + COD, BNPL, bank transfer, store credit, mixed). The first engine version treated anything that was not COD as prepaid and shipped it with nothing to collect. An unpaid bank transfer or an unrecognised manual method would therefore ship with COD = 0, losing the full order value silently.

## Decision

- Canonical orders carry `paymentMode`, `paymentStatus`, `received`, `outstanding`, `refunded`.
- One shared rule, `cashToCollect(order)` in `packages/engine/src/core/payments.ts`, decides the courier amount for every courier connector: COD collects the outstanding amount; deposit orders collect the balance; paid card/wallet/BNPL/bank orders collect 0; unpaid, failed, refunded or unknown-method orders are **blocked** with a reason.
- Blocked orders arriving by auto-ship are held (`order.awaiting_payment`) and ship automatically when paid; forced ships dead-letter with the reason.
- Money arithmetic is exact (decimal strings → integer minor units; 3-decimal currencies).
- Only orders where the courier collected cash are marked paid on delivery.

## Consequences

Some orders wait for a person (unknown methods) instead of shipping. Merchants can extend gateway patterns per tenant. Every storefront connector must fill the payment fields; the chaos suite asserts the courier amount for every method.
