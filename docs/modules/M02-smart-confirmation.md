# M2 — Order verification and confirmation · التحقق من الأوردرات وتأكيدها

> **Phase:** MVP · **Depends on:** M1 Orders, M14 Scripts, M11 Risk network, M13 Automations  
> **Estimate:** 3 sprints — 2 backend + 1 frontend. WhatsApp Business API approval runs in parallel.

_Every order is checked the cheapest safe way: COD orders are confirmed, prepaid orders are screened for fraud._

## Purpose

Verification scores every order 0–100 and picks how to check it. Cash-on-delivery orders are confirmed by auto-rules, a WhatsApp bot or an agent before they ship. Prepaid orders (card, wallet, BNPL, bank transfer) skip confirmation but go through fraud and chargeback screening, address verification and, for high-value or mismatched orders, a manual review. The goal is the same for every payment method: ship only orders that will be delivered and kept.

## Users

| User | Uses it to |
| --- | --- |
| Agent | Works the call queue, logs outcomes |
| Ops manager | Tunes thresholds, watches rates |
| Owner | Sees confirmation and delivery rates |
| Customer | Confirms by WhatsApp in their dialect |

## Success metrics

| Metric | Definition |
| --- | --- |
| Confirmation rate | Confirmed ÷ orders, per route |
| Auto-confirm share | Confirmed without a human |
| Time to confirm | Order created to confirmed |
| Delivered after confirm | Proof the score works |

## Flow — Score, route, confirm, and **learn from every delivery**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | ⭐ Score the order | Customer history, duplicates, address quality, value, phone validity, risk network. | Automatic |
| 2 | Pick the route | Thresholds map the score to auto, bot, agent or hold. | Automatic |
| 3 | WhatsApp bot | Order summary, Confirm / Change / Cancel buttons, location pin request. | Customer |
| 4 | Agent call | Click-to-call with the script from M14; outcome code logged. | Agent |
| 5 | Retry or close | No answer retries on a schedule; then cancel or hold. | Automatic |
| 6 | Learn | Delivery outcome feeds back to tune the score. | Automatic |

- **Explainable.** Every score shows its top three reasons, so agents trust it and owners can tune it.
- **Fallbacks.** Bot no reply in 2 hours moves the order to the agent queue automatically.
- **Fair load.** Orders are spread across online agents by queue size and language.

## Main screen — Confirmation queue

Filters: `My queue · 38` · `Bot waiting · 112` · `Retry due · 14` · `On hold · 9` · `Done today · 287`  
Actions: Pause bot, Start calling

| Order | Customer | Score | Why | Route | Attempts |
| --- | --- | --- | --- | --- | --- |
| #WC-3381 | Sara M. | 78 | New phone, high value | Agent | 1 / 3 |
| #EO-48213 | Mona A. | 54 | Address unclear | Bot | Sent |
| #SH-10999 | Omar T. | 91 | Refused 3× elsewhere | Hold | — |
| #EO-48220 | Hana S. | 12 | 4 past deliveries | Auto | — |
| #LF-781 | Tarek F. | 61 | No reply to bot | Agent | 0 / 3 |

_Sample data. Full visual in `design/prototype.html`._

## Verification by payment method

| Payment method | Check | Typical route |
| --- | --- | --- |
| Cash on delivery | Confirmation (real order? right address? right items?) | Auto / WhatsApp bot / agent / hold |
| Deposit + COD balance | Deposit paid › light confirmation of the balance | Auto or bot |
| Card, wallet, Apple Pay | Fraud screening: velocity, mismatched names and addresses, high value, risky BIN or country, past chargebacks | Auto-approve or manual review |
| BNPL (Tabby, Tamara, valU) | Provider carries credit risk; check address and stock only | Auto |
| Bank transfer / InstaPay | Hold until payment is matched (M15); remind customer | Hold › auto when paid |

The risk score is one model with method-specific signals. Reasons are always shown.

## Rules — Default score factors and routes

| Signal | Effect on score | Source |
| --- | --- | --- |
| Past delivered orders | Lowers, per delivery | Customer history |
| Past refusals | Raises sharply | History + M11 network |
| Duplicate in 48 h | Raises | M1 |
| Address incomplete, no pin | Raises | Address check |
| Order value far above store average | Raises | Order |
| Invalid or new phone | Raises | Phone check |
| Score 0–25 · 26–60 · 61–85 · 86+ | Auto · Bot · Agent · Hold | Route thresholds |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Auto-confirm below | Score 25 |
| Hold above | Score 85 |
| Bot timeout | 2 hours |
| Agent retries | 3 over 24 hours |
| Calling hours | 10:00–22:00 local |
| Location pin | Requested if address weak |

> Weights start from defaults and are tuned per merchant on real delivery outcomes. Thresholds are proposals to validate in the pilot.

## Events emitted

| Event | Meaning |
| --- | --- |
| `confirmation.scored` | Score and reasons calculated |
| `confirmation.routed` | Route chosen: auto, bot, agent, hold |
| `confirmation.confirmed` | Order confirmed, by which route |
| `confirmation.no_answer` | Attempt failed, retry scheduled |
| `confirmation.cancelled` | Customer or agent cancelled |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `confirmation.send_bot` | Send the WhatsApp confirmation |
| `confirmation.to_agent` | Push into an agent's queue |
| `confirmation.hold` | Hold for manual review |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Full | Full | Full |
| Agent | Partial | Partial | — |
| Warehouse | — | — | — |
| Finance | Full | — | — |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Customer replies by voice note | Order moved to agent queue with the note attached |
| Customer changes items in chat | Bot offers Change; agent edits and re-confirms |
| Wrong number | Outcome logged; order cancelled; number flagged |
| Agent goes offline mid-queue | Their orders return to the shared queue |
| WhatsApp template rejected | Falls back to SMS link, then agent call |
| Customer confirms twice | Second reply ignored, no duplicate status |

## Acceptance criteria

- [ ] Confirmation rate is shown separately for auto, bot and agent.
- [ ] Every score shows its top three reasons.
- [ ] Bot no-reply moves the order to an agent after the timeout.
- [ ] Retries follow calling hours in the customer's time zone.
- [ ] A held order cannot ship until released.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/confirmation/queue` | Agent queue, prioritized |
| POST | `/v1/orders/{id}/score` | Recalculate the score |
| POST | `/v1/orders/{id}/attempts` | Log a call outcome |
| POST | `/v1/orders/{id}/bot` | Send WhatsApp confirmation |
| POST | `/v1/whatsapp/webhook` | Inbound replies |
| PUT | `/v1/settings/confirmation` | Thresholds and hours |

Conventions: `docs/05-api.md`.

## Entities

`RiskScore`, `ConfirmationAttempt`, `QueueAssignment`, `WhatsAppMessage` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Click-to-call through which telephony provider?
- Score rules first, or a trained model from day one?
- Do agents need a mobile queue app?
