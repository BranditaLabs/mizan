# 13 — Automation platform

Automation Studio (M13) is the backbone of Mizan: every module publishes events and exposes actions, and automations connect them — When → If → Then — without a developer. Module spec: `docs/modules/M13-automation-studio.md`.

## 1. Model

```
Automation = trigger (event or schedule)
           + conditions (fields, operators, groups, lookups)
           + steps (actions, waits, branches, splits)
           + guards (loop depth, message caps, quiet hours, rate limits)
           + versions (draft → test → publish → rollback)
```

Stored in `automations` (JSON definition, versioned) with one `automation_runs` row per event (`UNIQUE (automation_id, event_id)` → exactly one run per event).

## 2. Event and action catalogue (by domain)

| Domain | Events (triggers) | Actions |
| --- | --- | --- |
| Orders and channels | `order.created`, `order.duplicate_found`, `order.duplicate_resolved` (E5-3: kept or merged), `orders.reconciled`, `orders.reconciliation_gap` (E5-8: a store day's nightly check; store, day, counts, recovered), `order.assigned`, `order.tagged`, `order.store_cancel_failed` (E5-4: the store would not cancel it; reason), `orders.bulk_requested` / `orders.bulk_continue` / `orders.bulk_finished` (E5-4: action and counts), `order.status_changed`, `channel.order_received`, `listing.error` | `order.set_status`, ✅ `order.assign`, ✅ `order.add_tag`, `order.hold`, `listing.pause`, `listing.set_price` |
| Verification | `order.scored` (✅ E6-1: score, band, reason codes), `order.confirmed`, `order.confirmation_failed`, `confirmation.started`, `confirmation.routed` (E6-2: route and score), `confirmation.sent`, `confirmation.escalated` (E6-7), `offer.proposed`, `offer.accepted`, `offer.declined`, `offer.expired` (E6-11; ids, price and channel only), `offer.applied`, `offer.failed` (E6-13; added to the store's order, or why not) | `whatsapp.send_template`, `order.convert_to_prepaid`, `call.schedule` |
| Payments | `payment.link_sent`, `payment.received`, `payment.failed`, `refund.created`, `refund.completed`, `dispute.opened`, `order.awaiting_payment` | `payment.send_link`, `payment.capture`, `refund.create` |
| Fulfilment | `shipment.created`, `shipment.status_changed`, `shipment.stuck`, ✅ `stock.reserved`, ✅ `stock.released`, ✅ `stock.short` (a confirmed order couldn't be reserved: oversell blocked), ✅ `stock.received`, ✅ `stock.adjusted`, ✅ `stock.low` (available fell to the item's threshold), ✅ `stock.out` (available reached zero), ✅ `stock.changed` (available changed: drives the store push), `stock.reorder_suggested`, `po.received`, `supplier.late` | `shipment.book`, `shipment.cancel`, `po.create_draft`, `po.send`, `stock.transfer` |
| Returns | `ticket.created`, `ticket.sla_breached`, `return.inspected` | `ticket.create`, `ticket.assign` |
| Service | `conversation.created`, `conversation.sla_breached`, `conversation.resolved`, `csat.received` | `conversation.assign`, `conversation.reply`, `conversation.tag` |
| Money and finance | `pnl.recomputed` (an order's profit changed, E9-2: net, expected net, final, flags), `costs.changed` (a cost rule saved or stopped, E9-1; product costs saved, E9-2), `fx.rate_overridden` (a store set its own rate for a day, E9-1), `ads.spend_changed` (a day's ad spend typed, imported or removed, E9-3: store, days), `settlement.gap_found`, `cash.overdue`, `channel.payout_received`, `period.closed`, `einvoice.rejected` | ✅ `notify.team`, `export.journal`, `einvoice.submit`, `expense.create` |
| Growth | `customer.segment_entered`, `campaign.delivered`, `loyalty.tier_changed`, `metric.threshold_crossed` | `campaign.send`, `loyalty.add_points`, `audience.sync`, `report.send` |
| Platform | `schedule.cron`, `webhook.received`, ✅ `automation.run_failed`, ✅ `automation.paused`, `connection.connected`, `connection.disconnected`, `connection.needs_attention` (a courier key was refused, E4-5) | `webhook.call`, `automation.run`, `sheet.append_row` |

Each module spec lists its own events and actions in section 05. The catalogue is served at `GET /v1/catalog` and must be generated from code (one registry), never hand-maintained in two places.

## 3. Recipe library (installs as editable drafts)

| Domain | Recipe | When / if | Then |
| --- | --- | --- | --- |
| Orders | Duplicate guard | Same phone + product within 48 h | Hold newer order, tag duplicate, notify ops |
| Verification | COD rescue | COD order scored 61+ and value EGP 1,500+ | Deposit or prepaid link with 5% off; if unpaid in 6 h, agent call |
| Verification | Card fraud review | Card order, mismatched name/address, value 3× average | Hold, review queue, do not capture |
| Payments | Bank transfer reminder | Bank-transfer order unpaid after 12 h | WhatsApp reminder; cancel after 48 h, release stock |
| Payments | Failed payment recovery | Link failed or expired | New link with another method (wallet, BNPL) |
| Payments | Refund follow-up | Refund not confirmed in 3 days | Check gateway, alert finance, message customer |
| Fulfilment | Stuck parcel | No courier update for 48 h | Courier ticket, WhatsApp customer, alert ops |
| Fulfilment | Low stock reorder | Available under reorder point on a best-seller | Draft PO, alert owner, pause ads (M7) |
| Channels | Listing error | Marketplace rejects a listing | Pause listing, ops task with the reason |
| Service | Where is my order | Inbound message asks about delivery | Reply with live tracking; hand off if unresolved |
| Service | SLA breach | No first reply within SLA | Reassign; alert manager |
| Money | Cash chase | Courier cash overdue 10 days | Email courier account manager, open claim, notify finance |
| Money | Payout gap | Gateway or marketplace payout short by > 2% | Flag lines, notify finance |
| Growth | Post-delivery review | Delivered or paid 3 days ago | Review request; loyalty points |
| Growth | Win-back | VIP with no order for 2× usual gap | Win-back offer; tag |
| Growth | Refuser guard | Customer refused 2+ times | Require prepaid; ad exclusion audience |

Source of truth for the PDF and these docs: `RECIPES_ALL` in the content file used to build the module library. ✅ In code (E11-2): `apps/api/src/modules/automations/recipes.ts`, each recipe tested against the catalogue in Arabic and English. Built so far with today's actions: big COD orders, review risky orders, duplicate guard, orders waiting for stock, low stock alert, out of stock alert, cancel didn't reach the store, connection needs attention. The recipes above that need waits, payment links or customer messages arrive with those actions.

## 4. Runtime guarantees

✅ Built (E11-1, E11-3): the catalogue in code (`apps/api/src/modules/automations/catalog.ts`, `GET /v1/catalog`); conditions (`conditions.ts`, ALL/ANY one level, no personal-data fields); the runtime as the event consumer `automations.run` (every event, exactly once per automation and event); actions `order.add_tag`, `order.assign`, `notify.team` (team notifications by role); loop guard (depth 3, carried as `automationDepth` in the events a run causes); error guard (more than 20 % of the last 20 runs failed, at least 5 → paused, `automation.paused`, team told); versions on every save; dry run. Not yet: waits, retries per action (a failed step fails the run; the next event runs again), schedules, message caps and quiet hours (with the first messaging action), the When → If → Then builder UI (recipes, switches, run log and the notification bell ✅ E11-2).

| Guarantee | How |
| --- | --- |
| Reacts within seconds | Subscribes to domain events (outbox dispatcher), no polling |
| Exactly one run per event | `automation_runs UNIQUE (automation_id, event_id)` |
| Idempotent actions | Each action call carries `automation:{runId}:{stepIndex}` as idempotency key |
| Fresh data | Conditions re-read entities at run time; re-checked after waits |
| Durable waits | Waits stored as scheduled jobs; survive restarts |
| Retries | 3 attempts with backoff per action, then run fails and is logged |
| Loop guard | Max chain depth 3 (automation → event → automation) |
| Customer protection | Max 3 messages per customer per day across automations; quiet hours 22:00–10:00 |
| Error guard | Error rate > 20% → automation auto-paused, owner alerted |
| Safe testing | Dry-run on a real past order: every step evaluated, nothing sent |
| Versioning | Publish creates a version; in-flight runs finish on their version; one-click rollback |
| Audit | Every run and step logged; actions that spend money or message customers need publish rights |

## 5. AI steps (V2–V3)

- **Classify:** inbound message topic and sentiment (M17), free-text WhatsApp replies (M2).
- **Draft:** reply drafts with sources (order, tracking, policy); agent sends by default.
- **Explain:** analyst answers questions over the merchant's data with cited numbers (M12).

AI steps never move money or cancel orders on their own; they suggest, and a rule or a person decides.

## 6. Build order

1. MVP: runtime + recipes for orders, verification, payments, fulfilment (E11 in `docs/10-backlog.md`).
2. V2: visual canvas, custom automations, service/finance/growth recipes, webhooks out (M21).
3. V3: AI steps, cross-tenant recipe marketplace for agencies.
