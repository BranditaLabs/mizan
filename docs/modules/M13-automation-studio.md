# M13 — Automation Studio · استوديو الأتمتة

> **Phase:** MVP core · V2 builder · **Depends on:** Every module, M14 Scripts, Event bus  
> **Estimate:** 5 sprints — Engine (2) in MVP with recipes only; visual canvas (3) in V2. 2 backend + 1 frontend.

_The backbone of Mizan: anything that happens in any module can trigger what happens next, without a developer._

## Purpose

Automation Studio is a visual When › If › Then builder on top of Mizan's event bus. Every module emits events (an order scored, a parcel stuck, stock low) and exposes actions (send WhatsApp, assign, book courier). Merchants connect them on a canvas, test against real orders, and publish versions — no code.

## Users

| User | Uses it to |
| --- | --- |
| Ops manager | Builds and tunes automations |
| Owner | Installs recipes, sees results |
| Brandita team | Sets up automations for clients |
| Developer | Adds webhooks and custom actions |

## Success metrics

| Metric | Definition |
| --- | --- |
| Manual steps removed | Actions done by automations |
| Runs and errors | Reliability per automation |
| Outcome per automation | e.g. orders rescued, cash recovered |
| Time to build | Idea to published |

## Flow — Pick a trigger, add conditions, chain actions, **test**, publish.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Trigger | Choose an event from any module, or a schedule. | Builder |
| 2 | Conditions | Filter with fields, operators, groups and lookups. | Builder |
| 3 | Actions | Chain actions; add waits and yes/no branches. | Builder |
| 4 | ⭐ Test | Dry-run on a real past order; see each step's result, nothing is sent. | Builder |
| 5 | Publish | New version goes live; the old version finishes its running jobs. | Owner / ops |
| 6 | Monitor | Runs, errors and outcomes per automation and version. | Automatic |

- **Built on events.** Automations never poll. They react to events on the bus within seconds, with at-least-once delivery.
- **Safe by default.** Loop guard, rate limits per customer, quiet hours, and dry-run testing before publish.
- **Versioned.** Every publish is a version; roll back in one click, with run history kept per version.

## Main screen

See `design/prototype.html` and the module page in the PDF book.

## Building blocks

Every automation is **When → If → Then**.

| When · triggers (examples) | If · conditions | Then · actions (examples) |
| --- | --- | --- |
| `order.created` — new order synced | Field operators: is · is not · contains · in list | `order.set_status` — move order |
| `confirmation.scored` — risk score ready | Number operators: equals · not · above · below · between | `order.assign` — assign agent or team |
| `shipment.status_changed` — any courier status | Time: within · older than · day of week · hour | `whatsapp.send_template` — message the customer |
| `shipment.stuck` — no update past limit | Fields: any order, customer, shipment, stock field | `payment.send_link` — prepaid / deposit link |
| `stock.low` — stock under threshold | Groups: ALL of / ANY of, nested one level | `shipment.book` — book a courier |
| `ticket.sla_breached` — ticket overdue | Lookups: customer segment, past refusals, LTV | `ticket.create` — open a ticket |
| `cash.overdue` — courier cash late | Wait until: an event happens, or a time passes | `notify.team` — alert in app, email, Slack |
| `schedule.cron` — every day at 09:00, etc. | Split: A/B test by percentage | `webhook.call` — call any external URL |

## Built-in recipes (MVP)

Each recipe installs as a draft the merchant can edit. Thresholds are starting points, tuned per store.

| # | Recipe | When / If | Then |
| --- | --- | --- | --- |
| 01 | COD rescue | Order scored 61+ and value EGP 1,500+ | Send prepaid link with 5% off; if not paid in 6 h, agent call |
| 02 | Stuck parcel | No courier update for 48 hours | Open courier ticket, WhatsApp the customer, alert ops |
| 03 | Low stock | Available under threshold on a best-seller | Alert owner, draft a purchase order, pause ads (via M7) |
| 04 | Win-back | VIP with no order for 2× usual gap | Send win-back template; tag "win-back sent" |
| 05 | Refuser guard | Customer refused 2+ times | Require prepaid; add to ad exclusion audience |
| 06 | Cash chase | Courier cash overdue 10 days | Email courier account manager, open claim, notify finance |

### Rule format (JSON stored in `automations`)

```json
{
  "trigger_event": "order.scored",
  "conditions": { "all": [
    { "field": "order.riskScore", "op": "gte", "value": 61 },
    { "field": "order.total.amount", "op": "gte", "value": "1500.00" }
  ]},
  "actions": [
    { "type": "payment.send_link", "params": { "discountPct": 5 } },
    { "type": "wait", "params": { "hours": 6, "until": "order.paid" } },
    { "type": "order.assign", "params": { "team": "agents" }, "if": { "field": "order.paid", "op": "eq", "value": false } }
  ]
}
```

## Scope across the whole OS

Automation Studio is not a confirmation tool: every module emits events and exposes actions. The full catalogue and recipe library across orders, payments, inventory, purchasing, service, finance and marketing is in **`docs/13-automation-platform.md`**.

## Rules — How a run executes

| Stage | What happens | Guarantee |
| --- | --- | --- |
| Match | Event on the bus matched to published automations | Within seconds |
| Check | Conditions evaluated on fresh data | Read at run time |
| Act | Actions run in order; each is logged | Idempotent action keys |
| Wait | Run paused until a time or event | Survives restarts |
| Retry | Failed action retried with backoff | 3 times, then error |
| Guard | Same automation, same order, loop depth | Max depth 3 |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Max runs per order per automation | 1 by default |
| Customer message cap | 3 per day across automations |
| Quiet hours | 22:00–10:00 for messages |
| Retry policy | 3 tries, backoff |
| Who can publish | Owner, ops manager |

> Actions that message customers or spend money (prepaid discounts, courier bookings) need publish rights; everyone else can build and test drafts.

## Events emitted

| Event | Meaning |
| --- | --- |
| `automation.run_started` | A run began, with its trigger event |
| `automation.run_failed` | An action failed after retries |
| `automation.published` | A new version went live |
| `automation.paused` | Paused by a user or by the error guard |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `automation.run` | Start another automation (sub-flow) |
| `webhook.call` | Call an external system |
| `notify.team` | Alert people in app, email or Slack |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Full | Full | Full |
| Agent | — | — | — |
| Warehouse | — | — | — |
| Finance | Full | — | — |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Automation triggers itself | Loop guard stops at depth 3; error logged |
| Order changed during a wait | Conditions re-checked when the run resumes |
| Action target missing (order deleted) | Run ends cleanly as skipped |
| Error rate above 20% | Automation auto-paused; owner alerted |
| Two automations message the same customer | Daily message cap applies across all |
| Published while runs are waiting | Waiting runs finish on the old version |

## Acceptance criteria

- [ ] A recipe installs, tests on a past order, and publishes in under 10 minutes.
- [ ] Dry-run sends nothing and shows every step's result.
- [ ] Every run has a full step-by-step log.
- [ ] Rollback to a previous version in one click.
- [ ] Loop guard and message cap cannot be disabled by builders.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/automations` | List with status and stats |
| POST | `/v1/automations` | Create a draft |
| POST | `/v1/automations/{id}/test` | Dry-run on an order |
| POST | `/v1/automations/{id}/publish` | Publish a version |
| GET | `/v1/automations/{id}/runs` | Run log |
| GET | `/v1/catalog` | Triggers, conditions, actions |

Conventions: `docs/05-api.md`.

## Entities

`Automation`, `AutomationVersion`, `Run`, `RunStep`, `Schedule` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- MVP: recipes with editable thresholds only, canvas in V2?
- Allow custom code steps, or webhooks only?
- Slack and email notifications in MVP?
