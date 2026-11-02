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
| Profit per completed order | Net profit of the orders that reached an end ÷ those orders (orders still moving left out of both) ✅ L1-7 | M5 |
| Confirmed automatically | Orders confirmed with nobody involved ÷ confirmed orders ✅ L1-7 | M2 |
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

✅ Built (E15-2, `apps/api/src/modules/reports/dashboards.ts`, web `/reports`): five built-in dashboards (overview, operations, profit, payments, stock) whose tiles are metric-layer values, plus daily series (orders per day, net profit per day). A role sees a dashboard only when it may see at least one of its metrics, and inside it only those tiles; the profit series is for money readers. Periods: the last 7, 30 or 90 store days, or a range. Every dashboard downloads as Excel (one sheet, right-to-left for Arabic readers, numbers as numbers) or CSV (UTF-8 with BOM so Excel reads Arabic; cells starting with `= + - @` are defused). The files are written in-process (`platform/xlsx.ts`, no dependency). The team dashboard waits for agent performance (M10); PDF export and saved reports are V2.

✅ Built (L1-7, pilot measurement baseline): a sixth built-in dashboard, **Pilot** (`pilot`, AR "متابعة التجربة"): orders, delivered rate, RTO rate, ad cost per delivered order, profit per completed order and confirmed automatically, with orders and net profit per day; each role sees the tiles it may (an agent sees orders only). Two metrics joined the layer: **profit per completed order** (`profit_per_completed_order`, M5, money: the net profit of the period's orders that reached an end (delivered, or refused and returned) ÷ those orders; orders still moving are left out of both, since their costs are booked before their cash arrives; the same rows as net profit and delivered rate; minor units rounded half away from zero, so a loss stays exact) and **confirmed automatically** (`automation_share`, M2, percent: orders of the period with a confirmed attempt in `confirmations` made with nobody involved, the routing rule (`auto`) or the customer answering the WhatsApp bot, the link page, an SMS link or an automated/AI call, with no `agent_id`, ÷ confirmed orders of the period, counted as the confirmation report counts them (confirmed or further, or confirmed then cancelled); the team's calls, the order screen, bulk confirmation and orders confirmed with no attempt (from the store, an exchange's replacement) are not automated). Every period can also be an ISO week: `week=YYYY-Www` (Monday–Sunday in store days) or `week=last` (the last full week), so the weekly CSV is `/v1/dashboards/pilot/export?format=csv&week=2026-W43` (`mizan-pilot-2026-W43.csv`); Reports offers "Last full week" next to 7/30/90 days. The settings table's "Week starts Saturday (EG)" is for scheduled reports (V2); the pilot's week is ISO so weeks compare across stores.

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
| GET | `/v1/dashboards` · `/v1/dashboards/{id}` | Built-in dashboards the caller may see, with tiles and daily series ✅ E15-2 |
| GET | `/v1/dashboards/{id}/export?format=xlsx\|csv` | The dashboard as an Excel or CSV file ✅ E15-2; `&week=YYYY-Www\|last` for one ISO week ✅ L1-7 |

Conventions: `docs/05-api.md`.

## Entities

`Report`, `Metric`, `Dashboard`, `Schedule` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Embed a BI tool or build the builder in-house?
- Which dashboards are free vs paid plans?
- Embed dashboards in the merchant's own tools?
