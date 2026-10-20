# M19 — Finance and accounting · المالية والحسابات

> **Phase:** V2 · **Depends on:** M5 Profit, M8 Reconciliation, M15 Payments, M16 Purchasing  
> **Estimate:** 3 sprints — Plus about 2 sprints for ZATCA Phase 2 and 1.5 for Egypt ETA.

_From order profit to the monthly P&L, VAT and e-invoices, without rebuilding it in Excel._

## Purpose

Finance turns operational data into the books: business P&L (order profit plus fixed costs and expenses), cash flow, VAT reports, e-invoices and e-receipts (ZATCA, Egypt ETA), and exports or sync to accounting tools (Zoho Books, Odoo, QuickBooks, Daftra). Mizan is not a full ledger; it is the source that keeps the ledger right.

## Users

| User | Uses it to |
| --- | --- |
| Finance | Close the month, VAT, exports |
| Owner | Business P&L and cash flow |
| Accountant (external) | Read-only access, exports |

## Success metrics

| Metric | Definition |
| --- | --- |
| Days to close | Month end to books closed |
| Unreconciled value | Money not matched to orders |
| E-invoice rejection rate | Rejected ÷ submitted |
| Operating margin | Operating profit ÷ net revenue |

## Flow — Order profit, minus everything else, **equals the real P&L**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Collect | Order P&L, payouts, refunds, supplier bills, payroll and expenses. | Automatic |
| 2 | Expenses | Rent, salaries, subscriptions; recurring and one-off; receipts attached. | Finance |
| 3 | ⭐ Tax | VAT on sales and purchases; e-invoices and e-receipts per country. | Automatic |
| 4 | Close | Month locked; adjustments logged. | Finance |
| 5 | Export / sync | Journal entries to the accounting tool. | Automatic |

- **Two views of profit.** Contribution profit per order (M5) and business P&L after fixed costs.
- **Locked periods.** Changes after close create adjustment entries.
- **Tax per merchant.** ZATCA and ETA onboarding is per merchant; see docs/06.

## Main screen — Business P&L · September

Filters: `P&L` · `Cash flow` · `VAT` · `Expenses` · `E-invoices`  
Actions: Export, Add expense

| Line | Amount | % of revenue |
| --- | --- | --- |
| Net revenue | EGP 3,640,000 | 100% |
| Contribution profit (orders) | EGP 729,000 | 20.0% |
| Salaries | −EGP 310,000 | 8.5% |
| Rent and tools | −EGP 96,000 | 2.6% |
| Operating profit | EGP 323,000 | 8.9% |

_Sample data. Full visual in `design/prototype.html`._

## Rules — Mapping to accounts

| Mizan source | Account (default) | Note |
| --- | --- | --- |
| Delivered / paid revenue | Sales | Net of discounts |
| Refunds | Sales returns | — |
| Gateway, COD, BNPL fees | Payment fees | Actual from payouts |
| Shipping and RTO | Delivery costs | — |
| COGS | Cost of goods sold | Moving average |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Accounting tool | None (CSV export) |
| Fiscal year start | January |
| VAT | Per country rules |
| Close reminder | 3rd working day |
| Expense approval | Owner above EGP 20,000 |

> Tax rules and e-invoicing scope must be confirmed by a local tax adviser per country before go-live.

## Events emitted

| Event | Meaning |
| --- | --- |
| `period.closed` | Month closed |
| `einvoice.rejected` | Tax authority rejected an invoice |
| `expense.added` | Expense recorded |
| `period.reopened` | A closed month was reopened by the owner |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `export.journal` | Export journal entries |
| `einvoice.submit` | Submit an e-invoice |
| `expense.create` | Record an expense (e.g. from a supplier bill) |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Partial | — | — |
| Agent | — | — | — |
| Warehouse | — | — | — |
| Finance | Full | Full | Full |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Refund after period close | Adjustment in the current period |
| E-invoice rejected | Fix and resubmit; order flagged |
| Multi-currency expense | FX at expense date |
| Expense in the wrong month | Moved with an audit entry while the month is open |
| Accounting sync fails | Export kept; retried; finance alerted |

## Acceptance criteria

- [ ] Monthly P&L equals sum of order profit minus recorded expenses.
- [ ] Journal export balances (debits = credits).
- [ ] Closed periods cannot be edited, only adjusted.
- [ ] VAT report matches order and purchase tax lines.
- [ ] Accounting export can be re-run without duplicates.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/finance/pnl` | Business P&L |
| GET / POST | `/v1/expenses` | Expenses |
| POST | `/v1/finance/periods/{id}/close` | Close a month |
| GET | `/v1/finance/exports` | Journal exports |
| GET | `/v1/finance/vat` | VAT report |

Conventions: `docs/05-api.md`.

## Entities

`Expense`, `Period`, `JournalExport`, `TaxDocument`, `AccountMapping` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Which accounting tool to sync first (Zoho Books, Odoo, Daftra)?
- Payroll inside Mizan or imported?
- Cash-flow forecast in V2 or V3?
