# M12 — Courier routing and AI analyst · توجيه الشحن والمحلل الذكي

> **Phase:** V3 · **Depends on:** M3 Shipping, M5 Profit, M7 Attribution, M8 Cash  
> **Estimate:** 4 sprints — Routing 1.5 sprints; analyst 2.5 sprints including evaluation on real merchant questions.

_The right courier for every parcel, and answers in plain Arabic about your numbers._

## Purpose

Two V3 intelligence features. Courier routing picks the best courier for each order by zone delivery rate, price and how fast that courier pays cash, within the merchant's rules. The AI analyst answers questions about the merchant's own data in Arabic or English, and always shows the numbers it used.

## Users

| User | Uses it to |
| --- | --- |
| Ops manager | Approves routing rules |
| Owner | Asks the analyst questions |
| Finance | Asks about cash and costs |
| Media buyer | Asks about campaign results |

## Success metrics

| Metric | Definition |
| --- | --- |
| Delivery rate lift | Before vs after routing |
| Shipping cost per delivered order | Lower is better |
| Questions answered | Analyst use per week |
| Answer accuracy | Checked against reports |

## Flow — Pick the courier with evidence. Answer questions **with sources**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Score couriers | Delivery rate, RTO, cost and days to remit, per courier per zone. | Automatic |
| 2 | Apply rules | Merchant limits: allowed couriers, max price, preferred partner. | Ops manager |
| 3 | ⭐ Pick and explain | Best courier chosen; reason shown on the order. | Automatic |
| 4 | Ask a question | "ليه الربح نزل الأسبوع ده؟" (why did profit drop this week?) | Owner |
| 5 | Query safely | The analyst runs read-only queries on the tenant's data. | Automatic |
| 6 | ⭐ Answer with numbers | Short answer, the numbers used, and a link to the report. | Automatic |

- **Minimum data.** A zone needs enough recent shipments per courier before routing trusts it; until then the default courier is used.
- **Read-only.** The analyst can only read the merchant's own data and cannot change anything.
- **No made-up numbers.** Every figure in an answer comes from a query the user can open.

## Main screen — Ask Mizan

Filters: `Suggested: profit this week` · `RTO by courier` · `Best campaign` · `Cash held`  
Actions: Routing rules

| Zone | Bosta | J&amp;T | Aramex | Chosen | Why |
| --- | --- | --- | --- | --- | --- |
| Cairo | 91% | 88% | 86% | Bosta | Best rate, same price |
| Alexandria | 84% | 89% | 85% | J&T | +5 pts delivery |
| Upper Egypt | 72% | 70% | 81% | Aramex | +9 pts, +EGP 10 |
| Delta | 87% | 86% | — | Bosta | Pays cash 3 d faster |
| Sinai | — | — | — | Default | Not enough data |

_Sample data. Full visual in `design/prototype.html`._

## Rules — Routing score, per courier and zone

| Factor | Weight (default) | Source |
| --- | --- | --- |
| Delivery rate, last 60 days | High | M3 scorecard |
| RTO rate | High (negative) | M3 |
| Price for this parcel | Medium | Courier rate card |
| Days to remit cash | Medium | M8 |
| Merchant preference | Tie-breaker | Settings |
| Minimum sample size | Required | Otherwise default courier |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Auto-routing | Suggest only, then auto |
| Allowed couriers | Merchant picks |
| Max price difference | EGP 15 |
| Analyst language | Follows the question |
| Analyst data scope | Own tenant, read-only |

> Routing starts in 'suggest' mode so ops can compare its picks against their own before switching it to automatic.

## Events emitted

| Event | Meaning |
| --- | --- |
| `routing.chosen` | Courier picked, with reason |
| `routing.overridden` | Ops chose a different courier |
| `analyst.answered` | A question was answered |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `routing.choose` | Pick a courier for an order |
| `analyst.weekly_brief` | Send a weekly written summary |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Full | Full | Full |
| Agent | — | — | — |
| Warehouse | Partial | — | — |
| Finance | Full | Full | — |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Zone has no data | Default courier; reason shown |
| Courier price changes | Rate card update; scores recalculate |
| Question outside the data | Analyst says it cannot answer from Mizan data |
| Question needs another tenant's data | Refused; tenant isolation |
| Analyst unsure | Says so and shows what it found |
| Ops overrides routing | Logged; used to tune weights |

## Acceptance criteria

- [ ] Routing shows its reason on every order.
- [ ] Suggest mode can run alongside manual choice.
- [ ] Every analyst figure links to its query.
- [ ] The analyst cannot write or change data.
- [ ] Answers come in the language of the question.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/routing/choose` | Courier for an order |
| GET | `/v1/routing/scorecard` | Courier scores by zone |
| PUT | `/v1/settings/routing` | Rules and mode |
| POST | `/v1/analyst/ask` | Ask a question |
| GET | `/v1/analyst/answers/{id}` | Answer with sources |

Conventions: `docs/05-api.md`.

## Entities

`CourierScore`, `RoutingDecision`, `RateCard`, `AnalystQuestion` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Which LLM provider, hosted in which region?
- Routing auto by default, or always suggest?
- Analyst in V3, or a simpler weekly brief first?
