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

## Automated confirmation (built, E6-7)

Every new cash-on-delivery or deposit order (placed in the last 24 hours, never imported history) becomes **Waiting to confirm** and walks the store's cascade without anyone touching it:

1. **WhatsApp** — order summary with Confirm / Change / Cancel and the link (wait 2 h).
2. **SMS with the confirm link** (wait 2 h).
3. **Automated call** — "press 1 to confirm, 2 to change, 3 to cancel" (wait 1 h, twice), only within calling hours (10:00–22:00 store time).
4. **Agent** — whatever is left unanswered, or a change request.

The customer can always answer on the **link page** (`/c/{token}`, no app, no sign-in): their order, the amount to pay on delivery, Confirm in one tap, Change (a note, stored encrypted), Cancel (a reason), and optionally their location for the courier. Every channel answers through one service: the order becomes Confirmed or Cancelled, the timeline and attempts log record who and how, a second answer is refused.

Vendors are pluggable (`MessagingProvider`): a channel with no vendor is skipped. With none connected, orders go straight to an agent, who sends the link on WhatsApp in one tap (wa.me, prefilled message); the customer's tap on Confirm is still automatic. Settings → Confirmation turns it on or off, orders the steps, sets the waits, calling hours and how long the link works.

**Next:** WhatsApp Cloud API (E6-4), SMS + IVR vendor (E6-8), then an **AI voice agent** (E6-9, V2) that talks with the customer in Egyptian Arabic, confirms, changes or reschedules, and hands off to a human when unsure — the same answer service, one more channel in the cascade.

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
| ✅ `confirmation.started`, `confirmation.sent`, `confirmation.escalated` | E6-7: a run started, a message or call went out, the order went to an agent (no reply, no channel, change requested) |
| ✅ `order.confirmed`, `order.confirmation_failed` | E6-7: answered by any channel (`channel` in data) |

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
| GET / PUT | `/v1/settings/confirmation` | ✅ E6-7: on/off, steps and waits, calling hours, link lifetime; connected channels |
| GET | `/v1/orders/{id}/confirmation` | ✅ E6-7: the run, steps, attempts |
| POST | `/v1/orders/{id}/confirmation/link` | ✅ E6-7: link + WhatsApp (wa.me) message to send by hand |
| POST | `/v1/orders/{id}/confirmation` | ✅ E6-7: agent records confirm / cancel |
| GET / POST | `/v1/public/confirm/{token}` | ✅ E6-7: the customer's link page (no sign-in) |

Conventions: `docs/05-api.md`.

## Entities

`RiskScore`, `ConfirmationAttempt`, `QueueAssignment`, `WhatsAppMessage` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Click-to-call through which telephony provider?
- Score rules first, or a trained model from day one?
- Do agents need a mobile queue app?
