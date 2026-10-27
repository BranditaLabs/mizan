# M20 — Analytics and reports · التحليلات والتقارير

> **Phase:** MVP core · V2 builder · **Depends on:** All modules  
> **Estimate:** 3 sprints — MVP: built-in dashboards + exports (1.5). V2: builder and schedules (1.5).

_Every number in Mizan, sliced any way, on a schedule, in Arabic and English._

## Purpose

Analytics gives each role the dashboards it needs and lets merchants build their own reports from any Mizan data: orders, payments, shipping, stock, profit, team, ads and service. Reports can be saved, shared, scheduled to email or WhatsApp, and exported.

## Users

| User | Uses it to |
| --- | --- |
| Owner | Business dashboards |
| Ops manager | Operational reports |
| Finance | Financial reports |
| Media buyer | Ad performance |

## Success metrics

| Metric | Definition |
| --- | --- |
| Weekly report users | Users opening a report weekly |
| Scheduled reports | Active schedules |
| Query time | p95 under 2 s |
| Exports per week | CSV / Excel / PDF downloads |

## Flow — Pick data, slice it, **share it on a schedule**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Built-in dashboards | Home, operations, profit, payments, stock, team. | Automatic |
| 2 | ⭐ Build | Dataset › metrics › dimensions › filters › chart or table. | Any role |
| 3 | Save and share | Private, team or tenant-wide. | Builder |
| 4 | Schedule | Daily, weekly, monthly to email or WhatsApp. | Builder |
| 5 | Alert | Metric crosses a threshold › automation trigger. | M13 |

- **Semantic layer.** Metrics are defined once (e.g. delivered rate) and reused everywhere, so numbers match across screens.
- **Fast.** Pre-aggregated daily tables; analytics store when volume requires.
- **Permission-aware.** Reports respect role access (e.g. agents cannot see profit).

## Main screen — Reports

Filters: `Dashboards` · `My reports` · `Shared` · `Scheduled`  
Actions: Schedule, New report

| Report | Owner | Dataset | Schedule | Last run |
| --- | --- | --- | --- | --- |
| Daily operations | Ops | Orders + shipments | Daily 09:00 | Today |
| Profit by product | Owner | Order P&L | Weekly Sun | Sun |
| Payment mix | Finance | Payments | Monthly | 1 Oct |

_Sample data. Full visual in `design/prototype.html`._

## Rules — Core metric definitions

| Metric | Definition | Module |
| --- | --- | --- |
| Delivered rate | Delivered ÷ shipped | M3 |
| Prepaid share | Prepaid orders ÷ all orders | M15 |
| Net profit | Sum of order net profit | M5 |
| Days of cover | Available ÷ avg daily sales | M4 |
| First response time | Median minutes to first reply | M17 |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Default currency | Tenant base |
| Week starts | Saturday (EG) / Sunday (KSA) |
| Data freshness | Up to 5 min |
| Exports | CSV, Excel, PDF |
| Default date range | Last 30 days |

> New metrics are added to the semantic layer in code with tests, never as ad-hoc SQL in a screen.

✅ Built (E15-1, `apps/api/src/modules/reports/metrics.ts`): orders, delivered rate, RTO rate, prepaid share, COD share, net profit, average order value, days of cover; each versioned, in Arabic and English, with the roles that see it; one set of facts per period of store days (the profit home's rows and filters, so its delivered rate and net profit are the same numbers, tested). First response time waits for the inbox (M17).

## Events emitted

| Event | Meaning |
| --- | --- |
| `metric.threshold_crossed` | A watched metric crossed its threshold |
| `report.delivered` | Scheduled report sent |
| `report.shared` | Report shared with a team |
| `dashboard.viewed` | Dashboard opened (usage analytics) |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `report.send` | Send a report now |
| `report.export` | Export to CSV, Excel or PDF |
| `metric.watch` | Watch a metric with a threshold |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Full | Full | Partial |
| Agent | Partial | — | — |
| Warehouse | Partial | — | — |
| Finance | Full | Full | Partial |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Report too large | Async export with link |
| Role cannot see a metric | Column hidden, not zero |
| Metric definition changes | Versioned; old reports keep the old definition until updated |
| Schedule recipient leaves the team | Removed from schedule automatically |
| Data still syncing | Report shows 'data up to HH:MM' |

## Acceptance criteria

- [ ] Same metric shows the same value on every screen.
- [ ] Scheduled reports arrive on time in the user's language.
- [ ] Every built-in dashboard works in Arabic and English.
- [ ] A metric alert triggers an automation within 5 minutes.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/reports` | Saved reports |
| POST | `/v1/reports/query` | Run a query |
| POST | `/v1/reports/{id}/schedules` | Schedule |
| GET | `/v1/metrics/catalogue` · `/v1/metrics/values` | Semantic metric catalogue and values ✅ E15-1 (`/metrics` itself is the Prometheus endpoint) |
| GET | `/v1/dashboards/{id}` | Dashboard with tiles |

Conventions: `docs/05-api.md`.

## Entities

`Report`, `Metric`, `Dashboard`, `Schedule` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Embed a BI tool or build the builder in-house?
- Which dashboards are free vs paid plans?
- Embed dashboards in the merchant's own tools?
