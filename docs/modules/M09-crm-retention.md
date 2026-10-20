# M9 — CRM, loyalty and marketing automation · العملاء والولاء والتسويق الآلي

> **Phase:** V2 · **Depends on:** M1 Orders, M2 Confirmation, M13 Automations, M14 Scripts  
> **Estimate:** 3 sprints — 1 backend + 1 frontend. Shares the WhatsApp layer with M2 and M14.

_One profile per customer across every store and channel, with segments, loyalty and campaigns that run themselves._

## Purpose

CRM builds a profile for every customer from their orders: what they bought, how much they are worth, and whether they accept deliveries. Merchants build segments and send WhatsApp campaigns and automated reorder reminders — only to customers who opted in.

## Users

| User | Uses it to |
| --- | --- |
| Owner | Grows repeat revenue |
| Marketing / Brandita | Builds segments and campaigns |
| Support agent | Sees full customer history |
| Ops manager | Spots frequent refusers |

## Success metrics

| Metric | Definition |
| --- | --- |
| Repeat purchase rate | Customers with 2+ delivered orders |
| Customer lifetime value | Net profit per customer |
| Campaign delivered revenue | Revenue from campaigns, delivered only |
| Opt-out rate | Kept low by relevance |

## Flow — Profile, segment, message, **measure in delivered cash**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Build profile | Orders, deliveries, refusals and tickets merged per phone number. | Automatic |
| 2 | Score value | Lifetime value from net profit, not revenue. | M5 |
| 3 | Segment | Rules like 'VIP', 'at risk', 'one-time', 'frequent refuser'. | Marketing |
| 4 | Message | WhatsApp template campaign or an automation (M13). | Marketing |
| 5 | Track | Replies, orders and deliveries attributed to the campaign. | Automatic |
| 6 | ⭐ Respect consent | Opt-in checked before every send; opt-out honored at once. | Automatic |

- **One customer, one phone.** Profiles merge on the normalized phone number across all the merchant's stores.
- **Value is profit.** A customer who orders often but refuses half is not a VIP. LTV uses net profit.
- **Consent first.** Marketing messages go only to opted-in customers; transactional messages stay separate.

## Main screen — Customers

Filters: `All · 18,402` · `VIP · 612` · `At risk · 1,940` · `One-time · 11,230` · `Refusers · 388`  
Actions: New segment, New campaign

| Customer | Orders | Delivered | Net LTV | Last order | Segment |
| --- | --- | --- | --- | --- | --- |
| Nour E. · Cairo | 7 | 7 | EGP 2,940 | 1 d | VIP |
| Hana S. · Giza | 4 | 4 | EGP 1,210 | 38 d | At risk |
| Omar T. · Alex | 5 | 1 | − EGP 610 | 3 d | Refuser |
| Faisal Q. · Riyadh | 3 | 3 | SAR 410 | 12 d | Repeat |
| Mona A. · Cairo | 1 | 0 | — | 6 min | New |

_Sample data. Full visual in `design/prototype.html`._

## Loyalty and marketing

- **Loyalty:** Points per delivered or paid order, tiers, store credit wallet (redeemed at checkout through the storefront app, or at POS).
- **Campaigns:** WhatsApp, SMS and email with opt-in; abandoned checkout, post-delivery review request, replenishment reminders, win-back.
- **Segments:** RFM, LTV, payment preference (pays online vs COD), refusal history, channel.
- All campaigns are Automation Studio flows (M13), so they can branch on any data in Mizan.

## Rules — Default segments

| Segment | Rule | Suggested use |
| --- | --- | --- |
| VIP | Top 5% by net LTV, no refusal in 6 months | Early access, no discount needed |
| Repeat | 2+ delivered orders | Cross-sell |
| At risk | Repeat customer, no order for 2× usual gap | Win-back offer |
| One-time | Exactly 1 delivered order | Second-order nudge |
| Frequent refuser | 2+ refusals, or refusal rate over 40% | Prepaid-only, exclude from ads |
| Opted out | Replied STOP or opted out | Transactional messages only |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Profile key | Normalized phone |
| LTV basis | Net profit |
| Campaign send window | 11:00–21:00 local |
| Max marketing messages | 2 per customer per week |
| Opt-out keywords | STOP, إلغاء |

> Segment rules are editable. Frequent refusers can be sent to M7 as an exclusion audience so ads stop finding them.

## Events emitted

| Event | Meaning |
| --- | --- |
| `customer.segment_entered` | Customer joined a segment |
| `customer.opted_out` | Customer opted out |
| `campaign.sent` | Campaign delivered to WhatsApp |
| `campaign.replied` | Customer replied |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `customer.add_tag` | Tag a customer |
| `campaign.send` | Send a template to a customer |
| `audience.sync` | Push a segment to an ad platform |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Full | Full | Partial |
| Agent | Partial | — | — |
| Warehouse | — | — | — |
| Finance | Full | — | — |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Same person, two numbers | Kept separate unless merged by a person |
| Customer opts out mid-campaign | Removed before the next send batch |
| Template not approved | Campaign blocked until Meta approves it |
| Customer replies to a campaign | Routed to the support inbox as a ticket |
| Segment empty at send time | Campaign skipped and logged |
| Shared phone (family) | Profile notes allowed; no auto-merge |

## Acceptance criteria

- [ ] Build a segment and send a campaign in under 5 minutes.
- [ ] No marketing message goes to an opted-out customer.
- [ ] LTV is based on net profit from M5.
- [ ] Campaign revenue counts delivered orders only.
- [ ] Frequent refusers can sync to an ad exclusion audience.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/customers` | List and search |
| GET | `/v1/customers/{id}` | Full profile |
| POST | `/v1/segments` | Create a rule-based segment |
| POST | `/v1/campaigns` | Create and schedule a campaign |
| GET | `/v1/campaigns/{id}/results` | Sends, replies, delivered revenue |
| POST | `/v1/customers/{id}/consent` | Record opt-in or opt-out |

Conventions: `docs/05-api.md`.

## Entities

`Customer`, `Segment`, `Campaign`, `Consent`, `Tag` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Opt-in captured at checkout, or by first WhatsApp message?
- Include SMS as a channel?
- Push audiences to Meta in V2 or V3?
