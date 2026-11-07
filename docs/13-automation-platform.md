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
| Orders and channels | `order.created`, `order.duplicate_found`, `order.duplicate_resolved` (E5-3: kept or merged), `orders.reconciled`, `orders.reconciliation_gap` (E5-8: a store day's nightly check; store, day, counts, recovered), `order.assigned`, `order.tagged`, `order.untagged` (O2: tags taken off), `order.note_added` (O2: note id, never its text), `order.edited` (O3: an edit applied; manual now, a store's once the store has it), `order.edit_failed` (O3: the store refused it; reason), `product.updated` (P2: edited in Mizan; the fields changed and its store), `product.created` (P3: made in Mizan), `product.published` / `product.publish_failed` (P3: a store has it, with its id; or refused it, and why), `order.store_cancel_failed` (E5-4: the store would not cancel it; reason), `order.store_fulfilled` (two-way delivery: shipped in the store with another courier; company and tracking), `order.store_copy_failed` (an order made in Mizan could not be created in the store; reason), `sync.recovered` (the sync guardian re-queued lost writes or bookings for a store; counts), `orders.bulk_requested` / `orders.bulk_continue` / `orders.bulk_finished` (E5-4: action and counts), `order.status_changed`, `channel.order_received`, `listing.error` | `order.set_status`, ✅ `order.assign`, ✅ `order.add_tag`, `order.hold`, `listing.pause`, `listing.set_price` |
| Verification | `order.scored` (✅ E6-1: score, band, reason codes), `order.confirmed`, `order.confirmation_failed` (✅ E6-23a: `cancelReason`; ✅ E6-16a: `cancelReasonId`, the store's own reason when the buyer picked one in the chat; `order.cancelled` carries it too), ✅ `confirmation.no_answer` (E6-23a: the automatic messages, or the team's last call, went unanswered: `stage` messages or team_calls), ✅ `order.ready_to_ship` (E6-23a: released after confirmation for automatic booking), ✅ `order.auto_ship_blocked` (E6-23a: automatic booking stopped: `code`), `confirmation.started`, `confirmation.routed` (E6-2: route and score), `confirmation.sent`, `confirmation.escalated` (E6-7), `offer.proposed`, `offer.accepted`, `offer.declined`, `offer.expired` (E6-11; ids, price and channel only), `offer.applied`, `offer.failed` (E6-13; added to the store's order, or why not), ✅ `whatsapp.template_submitted` (E6-16d: the owner sent a first-message template to Meta; `variant`, `template` name) | `whatsapp.send_template`, `order.convert_to_prepaid` ✅ (E14-3: `{ purpose: full\|deposit, depositPct?, method }`; makes the offer and tells the team to send it), `call.schedule` |
| Billing | `plan.limit_reached` ✅, `plan.upgrade_requested` ✅ (E12-1); platform events, not merchant triggers (E12-2a): ✅ `subscription.trial_started` (plan, interval, endsAt), ✅ `subscription.trial_ended` (plan, outcome `downgrade_free`), ✅ `subscription.plan_changed` (from, to, by: user\|mizan_staff\|system; whenever the entitled plan changes); later `subscription.trial_ending` (a merchant trigger, E12-2d) and `invoice.payment_failed` | — |
| Payments | `payment.link_sent` ✅, `payment.link_paid` ✅ (E14-3: a conversion offer made, and paid), `payment.received`, `payment.failed`, `refund.created` ✅, `refund.approved` ✅, `refund.rejected` ✅, `refund.completed` ✅ (E14-4), `dispute.opened` ✅, `dispute.evidence_submitted` ✅, `dispute.closed` ✅ (E14-5: outcome won\|lost\|accepted), `order.awaiting_payment` | `payment.send_link`, `payment.capture`, `refund.create` |
| Fulfilment | ✅ `shipment.created` (the courier booked: tracking number, cash to collect; E7-1), ✅ `shipment.booking_failed` (the courier or the order refused the booking: `code`), ✅ `shipment.status_changed` (`from`, `to`, `source`; E7-3), ✅ `shipment.needs_review` (a status Mizan could not map, or one contradicting a final status), ✅ `shipment.delivered`, ✅ `shipment.returned`, `shipment.stuck`, ✅ `picklist.created`, ✅ `picklist.closed` (E8-4c), ✅ `order.packed` (every item scanned on the phone; `manual` when a code was typed), ✅ `stock.reserved`, ✅ `stock.released`, ✅ `stock.short` (a confirmed order couldn't be reserved: oversell blocked), ✅ `stock.received`, ✅ `stock.adjusted`, ✅ `stock.low` (available fell to the item's threshold), ✅ `stock.out` (available reached zero), ✅ `stock.changed` (available changed: drives the store push), ✅ `stock.reorder_suggested` (M16-4b: hourly, once per crossing: `sku`, `available`, `incoming`, `reorderPoint`, `suggested`, `daysCover`, `supplierId`), ✅ `po.approved`, ✅ `po.sent`, ✅ `po.cancelled`, ✅ `po.received` (M16-1: `receipt`, `units`, `damaged`, `complete`, `costStatus`, `overReceived`), `supplier.late` | `shipment.book`, `shipment.cancel`, `po.create_draft`, `po.send`, `stock.transfer` |
| Returns | `ticket.created` ✅, `ticket.status_changed` ✅, `ticket.assigned` ✅ (E10-1; context: the ticket's order when it has one), `ticket.sla_breached`, `return.inspected` ✅ (E10-3), `exchange.created` ✅ (E10-2: original and replacement, credit, refund due), `exchange.returned` ✅ (inspection covered the items), `order.partially_delivered` ✅ (E10-4: kept items, amount due), `order.refused` ✅ (reason, opened the box) | `ticket.create`, `ticket.assign` |
| Service | `conversation.created`, `conversation.sla_breached`, `conversation.resolved`, `csat.received` | `conversation.assign`, `conversation.reply`, `conversation.tag` |
| Money and finance | `pnl.recomputed` (an order's profit changed, E9-2: net, expected net, final, flags), `costs.changed` (a cost rule saved or stopped, E9-1; product costs saved, E9-2), `fx.rate_overridden` (a store set its own rate for a day, E9-1), `ads.spend_changed` (a day's ad spend typed, imported or removed, E9-3: store, days), `settlement.gap_found`, `cash.overdue`, `channel.payout_received`, `period.closed`, `einvoice.rejected` | ✅ `notify.team`, `export.journal`, `einvoice.submit`, `expense.create` |
| Growth | `customer.segment_entered`, `campaign.delivered`, `loyalty.tier_changed`, `metric.threshold_crossed` | `campaign.send`, `loyalty.add_points`, `audience.sync`, `report.send` |
| Platform | `schedule.cron`, `webhook.received`, ✅ `automation.run_failed`, ✅ `automation.paused`, `connection.connected`, `connection.disconnected`, `connection.needs_attention` (a courier key was refused, E4-5; a store that refuses Mizan, A2), `connection.sync_completed`, `connection.sync_failed` (a store's history import ended, A2) | `webhook.call`, `automation.run`, `sheet.append_row` |

Each module spec lists its own events and actions in section 05. The catalogue is served at `GET /v1/catalog` and must be generated from code (one registry), never hand-maintained in two places.

### 2.1 Motion per event (Brand 2.0, BR-1)

Every event above also has one **motion**: what the dashboard, the back office and the ops app play when it happens (docs/08 §Motion, docs/16 §2.5). Screens never pick an animation; they name the event and the catalogue decides. Source of truth: `EVENT_MOTION` in `packages/shared/src/motion/catalogue.ts` (with `TIMELINE_MOTION` for the order timeline and `ENGINE_MOTION` for the integration engine's own events), generated into the ops app as `apps/ops/lib/motion/event_motion.g.dart`. A new event is registered there in the same PR that registers it here; the shared tests fail until it is.

Outcomes: **settle** (arrives with a small overshoot), **done** (settles, merges, checks), **merge** (two values agree and flow into one), **tip** (off balance: something needs a look), **fail** (tips twice and rests in the danger tone), **drop** (the red falls once: only for something confirmed, on the checked-in allowlist), **quiet** (no motion). "While on its way" is the loader shown while the viewer's own action runs (pair = loading, transfer = syncing two systems, drop = saving or confirming, fill = known progress). "Red" says whether the event may spend the view's one red. Registered events with no emitter yet (`settlement.*`, `channel.payout_received`, `conversation.*`, `period.closed` and the rest) are mapped already, so they animate the day their emitter lands. Triggers named in §2 but not yet in the registry (`shipment.stuck`, `cash.overdue`, `csat.received`, `supplier.late`, …) get their row when they are registered in `packages/shared/src/events.ts`: the catalogue is typed by the registry, so it cannot be forgotten.

<!-- motion:begin (generated by packages/shared/scripts/gen-motion-docs.mjs; do not edit) -->
| Event | Motion (outcome) | While on its way | Red | Surfaces |
| --- | --- | --- | --- | --- |
| `tenant.created` | done | pair | no | card |
| `member.invited` | settle | drop | no | button, toast, list |
| `member.joined` | settle | — | no | list, bell |
| `member.updated` | settle | drop | no | button, toast, list |
| `member.removed` | settle | drop | no | button, toast, list |
| `privacy.requested` | settle; by `overdue`: overdue → tip, other → settle | — | no | list, bell |
| `privacy.completed` | done | drop | no | toast, list |
| `plan.limit_reached` | tip | — | no | bell, banner, kpi |
| `plan.upgrade_requested` | settle | drop | no | button, toast |
| `automation.run_failed` | fail | — | no | list, bell |
| `automation.paused` | fail | — | no | list, bell |
| `connection.connected` | merge | transfer | no | button, toast, sync |
| `connection.disconnected` | fail; by `byUser`: byUser → settle, other → fail | drop | no | sync, bell |
| `connection.needs_attention` | fail | — | no | sync, bell |
| `connection.sync_completed` | merge | transfer | no | sync, bell |
| `connection.sync_failed` | fail | — | no | sync, bell |
| `sync.recovered` | merge | — | no | sync, list |
| `order.created` | settle; by `manual`: manual → drop, other → settle | drop | yes (manual) | button, toast, list, kpi, timeline |
| `order.updated` | quiet | — | no | timeline |
| `order.cancelled` | settle | drop | no | button, timeline, list, kpi |
| `order.duplicate_found` | tip | — | no | banner, list, timeline |
| `order.duplicate_resolved` | merge | drop | no | button, toast |
| `orders.reconciled` | merge | transfer | no | sync, instrument |
| `orders.reconciliation_gap` | tip | — | no | sync, instrument, bell |
| `order.assigned` | settle | drop | no | timeline, queue |
| `order.tagged` | settle | drop | no | button, timeline |
| `order.untagged` | settle | drop | no | button, timeline |
| `order.note_added` | settle | drop | no | button, timeline |
| `order.edited` | done | drop | no | button, toast, card, timeline |
| `order.edit_failed` | fail | — | no | card, timeline |
| `order.store_cancel_failed` | fail | — | no | timeline, card |
| `order.store_copy_failed` | fail | — | no | timeline |
| `order.store_fulfilled` | done | — | no | timeline |
| `order.store_fulfillment_cancelled` | settle | — | no | timeline |
| `order.cancelled_after_shipping` | tip | — | no | queue, timeline, bell |
| `order.payment_changed` | settle; by `state`: paid → drop, failed → tip, refunded → settle, other → settle | — | yes (paid) | card, timeline, kpi |
| `order.awaiting_payment` | tip | — | no | card, list, timeline |
| `order.scored` | quiet | — | no | card, list |
| `order.confirmed` | drop | drop | yes (always) | button, toast, card, timeline, kpi, queue |
| `order.confirmation_failed` | fail | — | no | card, timeline |
| `confirmation.started` | settle | transfer | no | card, timeline |
| `confirmation.routed` | quiet | — | no | timeline |
| `confirmation.sent` | settle | drop | no | card, timeline |
| `confirmation.escalated` | tip | — | no | card, queue, timeline |
| `confirmation.no_answer` | tip | — | no | queue, timeline |
| `order.ready_to_ship` | done | — | no | list, timeline |
| `order.auto_ship_blocked` | tip | — | no | card, bell, timeline |
| `offer.proposed` | settle | drop | no | button, toast, card, timeline |
| `offer.accepted` | merge | — | no | card, timeline |
| `offer.declined` | settle | — | no | card, timeline |
| `offer.expired` | settle | — | no | card, timeline |
| `offer.applied` | merge | transfer | no | card, timeline |
| `offer.failed` | fail | — | no | card, timeline |
| `whatsapp.template_submitted` | settle | drop | no | button, toast |
| `order.packed` | done | fill | no | timeline, list |
| `order.partially_delivered` | tip | — | no | card, timeline |
| `order.refused` | fail | — | no | card, timeline |
| `shipment.created` | done | transfer | no | button, card, list, timeline |
| `shipment.booking_failed` | fail | — | no | card, list, timeline |
| `shipment.status_changed` | settle | — | no | list, timeline |
| `shipment.needs_review` | tip | — | no | queue |
| `shipment.delivered` | done | — | no | list, timeline, kpi, instrument |
| `shipment.returned` | fail | — | no | list, timeline, kpi |
| `picklist.created` | settle | drop | no | button, toast, list |
| `picklist.closed` | done | drop | no | button, toast, list |
| `stock.reserved` | quiet | — | no | card |
| `stock.released` | quiet | — | no | card |
| `stock.short` | tip | — | no | card, bell |
| `stock.received` | done | drop | no | toast, list, instrument |
| `stock.adjusted` | settle; by `matched`: matched → merge, other → settle | drop | no | button, toast, instrument |
| `stock.changed` | quiet | — | no | — |
| `stock.low` | tip | — | no | list, bell |
| `stock.out` | tip | — | no | list, bell |
| `stock.reorder_suggested` | settle | — | no | list |
| `pnl.recomputed` | quiet; by `final`: final → merge, other → quiet | transfer | no | card, kpi |
| `costs.changed` | settle | drop | no | button, toast |
| `fx.rate_overridden` | settle | drop | no | button, toast |
| `ads.spend_changed` | settle | drop | no | button, toast, instrument |
| `payment.received` | drop | drop | yes (always) | card, list, kpi, toast |
| `payment.failed` | fail | — | no | card, list |
| `payment.link_sent` | settle | drop | no | button, toast, card |
| `payment.link_paid` | drop | — | yes (always) | card, timeline, kpi |
| `refund.created` | settle | drop | no | button, toast, list |
| `refund.approved` | done | drop | no | button, toast, list |
| `refund.rejected` | settle | drop | no | button, toast, list |
| `refund.completed` | done | drop | no | toast, card, kpi |
| `dispute.opened` | tip | — | no | list, bell |
| `dispute.evidence_submitted` | settle | drop | no | button, toast, list |
| `dispute.closed` | settle; by `result`: won → drop, lost → fail, other → settle | — | yes (won) | list |
| `settlement.matched` | merge | transfer | no | instrument, list |
| `settlement.gap_found` | tip | — | no | instrument, bell |
| `ticket.created` | settle | drop | no | button, toast, list, card |
| `ticket.status_changed` | settle | drop | no | button, toast, card |
| `ticket.assigned` | settle | drop | no | card |
| `return.inspected` | done | drop | no | button, toast, card, timeline |
| `exchange.created` | done | drop | no | button, toast, card, timeline |
| `exchange.returned` | merge | — | no | card |
| `po.approved` | done | drop | no | button, toast, list |
| `po.sent` | settle | drop | no | button, toast, list |
| `po.cancelled` | settle | drop | no | button, toast, list |
| `po.received` | done; by `full`: full → merge, other → done | drop | no | toast, list, instrument |
| `product.created` | settle | drop | no | button, toast, list |
| `product.updated` | settle | drop | no | button, toast |
| `product.published` | done | transfer | no | card |
| `product.publish_failed` | fail | — | no | card |
| `orders.bulk_requested` | quiet | fill | no | card |
| `orders.bulk_continue` | quiet | fill | no | card |
| `orders.bulk_finished` | done; by `failed`: none → done, some → tip, all → fail, other → done | — | no | card, toast |
| `channel.order_received` | settle | — | no | list, kpi |
| `channel.payout_received` | drop | — | yes (always) | list, kpi, instrument |
| `conversation.created` | settle | — | no | list |
| `conversation.sla_breached` | tip | — | no | list, bell |
| `einvoice.rejected` | fail | — | no | list, bell |
| `listing.error` | fail | — | no | list, bell |
| `metric.threshold_crossed` | tip | — | no | kpi, bell |
| `period.closed` | merge | — | no | instrument, list |
<!-- motion:end -->

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
