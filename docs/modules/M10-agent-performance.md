# M10 — Agent performance and commissions · أداء الموظفين والعمولات

> **Phase:** V2 · **Depends on:** M2 Confirmation, M3 Shipping, M5 Profit  
> **Estimate:** 1.5 sprints — 1 backend + 1 frontend; reads mostly from M2 and M3 data.

_Pay agents for orders that get delivered — not for orders they click confirm on._

## Purpose

Agent Performance measures each confirmation agent on what matters: how many of the orders they confirmed were delivered. Commission rules pay per delivered order, with bonuses above target, and the monthly payout is calculated and exported automatically.

## Users

| User | Uses it to |
| --- | --- |
| Ops manager | Coaches agents, sets targets |
| Agent | Sees own numbers and earnings |
| Finance | Exports monthly payouts |
| Owner | Sees team cost per delivered order |

## Success metrics

| Metric | Definition |
| --- | --- |
| Delivery rate of confirmed | Per agent — the true quality |
| Confirmations per hour | Productivity |
| Commission per delivered order | Team cost |
| Handling time | Time per order |

## Flow — Measure quality, apply rules, **pay what was earned**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Log every attempt | Each call and outcome tied to the agent in M2. | Automatic |
| 2 | ⭐ Wait for the truth | Delivery or refusal from M3 credited back to the confirming agent. | Automatic |
| 3 | Score | Confirmation rate, delivery rate of confirmed, handling time. | Automatic |
| 4 | Apply rules | Per-delivered-order rate plus bonus tiers. | Automatic |
| 5 | Review | Ops manager reviews disputes before month close. | Ops manager |
| 6 | Pay | Payout sheet exported for payroll. | Finance |

- **Credit follows delivery.** Commission is earned only when the parcel is delivered, so confirming fake orders earns nothing.
- **Fair comparison.** Agents are compared within the same route and risk band, not across easy and hard queues.
- **Agents see their own.** Each agent sees only their own numbers and earnings, live.

## Main screen — Agent leaderboard · October

Filters: `This month` · `Last month` · `By route` · `By country`  
Actions: Commission rules, Export payouts

| Agent | Confirmed | Delivered | Deliv. rate | Avg time | Earned |
| --- | --- | --- | --- | --- | --- |
| Aya M. | 1,204 | 1,041 | 86% | 2:10 | EGP 5,205 |
| Mostafa R. | 1,388 | 1,027 | 74% | 1:35 | EGP 4,620 |
| Salma K. | 980 | 862 | 88% | 2:40 | EGP 4,310 |
| Ahmed N. | 1,450 | 913 | 63% | 1:05 | EGP 3,650 |
| Reem F. | 760 | 655 | 86% | 2:25 | EGP 3,275 |

_Sample data. Full visual in `design/prototype.html`._

## Rules — Commission rule example

| Component | Rule | Example |
| --- | --- | --- |
| Base | Fixed amount per delivered order | EGP 4 each |
| Quality bonus | Delivery rate of confirmed 85% or more | + 15% on base |
| Volume bonus | Over 1,000 delivered in month | + EGP 500 |
| Penalty | Confirmed order cancelled for agent error | − base amount |
| Cap | Optional monthly maximum | None by default |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Credit on | Delivered |
| Base rate | Set per merchant |
| Bonus threshold | 85% delivery rate |
| Month close | Last day + 7 days for late deliveries |
| Agents see earnings | Yes, own only |

> Amounts shown are examples, not recommendations. Each merchant sets rates in their own currency.

## Events emitted

| Event | Meaning |
| --- | --- |
| `agent.target_reached` | Agent crossed a bonus threshold |
| `agent.quality_drop` | Delivery rate fell below threshold |
| `payout.ready` | Monthly payout calculated |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `agent.notify` | Send an agent a message |
| `payout.export` | Export the payout sheet |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Full | Full | Full |
| Agent | Partial | — | — |
| Warehouse | — | — | — |
| Finance | Full | Full | — |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Order delivered after month close | Credited to next month's payout |
| Two agents worked one order | Credit to the agent who confirmed |
| Order reassigned mid-call | Attempt stays with the first agent |
| Agent disputes a refusal | Ops manager can reassign credit, logged |
| Agent leaves mid-month | Payout calculated to last day |
| Rule changed mid-month | Applies from the change date only |

## Acceptance criteria

- [ ] Commission per agent is calculated automatically.
- [ ] Credit only on delivered orders.
- [ ] Agents see only their own numbers.
- [ ] Payout exports to CSV for payroll.
- [ ] Rule changes are dated and logged.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/agents/performance` | Leaderboard for a period |
| GET | `/v1/agents/{id}` | Agent detail and earnings |
| PUT | `/v1/commission/rules` | Set commission rules |
| POST | `/v1/payouts/close` | Close the month |
| GET | `/v1/payouts/{month}/export` | Payout CSV |

Conventions: `docs/05-api.md`.

## Entities

`AgentStat`, `CommissionRule`, `Payout`, `CoachingNote` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Do merchants pay per confirmed or per delivered today?
- Show a team leaderboard to agents, or own numbers only?
- Integrate with a payroll tool later?
