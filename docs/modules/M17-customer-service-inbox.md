# M17 — Customer service inbox · صندوق خدمة العملاء

> **Phase:** V2 · **Depends on:** M6 Tickets, M9 CRM, M13 Automations, M15 Payments  
> **Estimate:** 3 sprints — 1 backend + 1 frontend; reuses the WhatsApp layer from M2/M14.

_Every customer message, from every channel, next to the order it is about._

## Purpose

The inbox brings WhatsApp, Instagram, Messenger, email and website chat into one shared queue. Each conversation is linked to the customer and their orders, so agents answer 'where is my order?' in one click, open tickets (M6), send payment links (M15) and let automations and an AI assistant reply to common questions.

## Users

| User | Uses it to |
| --- | --- |
| Agent | Answers conversations |
| Ops manager | Assigns, sets SLAs |
| Owner | Response times and satisfaction |

## Success metrics

| Metric | Definition |
| --- | --- |
| First response time | Median, by channel |
| Resolution time | Open to resolved |
| Auto-resolved share | Resolved by bot or AI without an agent |
| CSAT | Post-chat rating |

## Flow — From first message to resolved, **in one queue**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Message arrives | WhatsApp, Instagram, Messenger, email, web chat. | Automatic |
| 2 | Identify | Matched to customer by phone, email or handle; recent orders attached. | Automatic |
| 3 | ⭐ Auto-reply | Tracking, order status, FAQs answered by flow or AI with sources. | Automatic |
| 4 | Route | To team or agent by language, channel, topic, VIP. | Automatic |
| 5 | Resolve | Reply with saved answers, open ticket, send link, refund. | Agent |
| 6 | Rate | Short satisfaction survey after resolve. | Automatic |

- **Same WhatsApp number.** Confirmation (M2), campaigns (M9) and support share one number and one history.
- **Hand-off kept.** Bot to human hand-off keeps the full conversation.
- **SLA timers.** Business hours per team; breaches trigger automations.

## Main screen — Inbox

Filters: `Mine` · `Unassigned` · `Waiting` · `VIP` · `Resolved`  
Actions: Saved replies, New message

| Customer | Channel | Last message | Order | Topic | SLA | Agent |
| --- | --- | --- | --- | --- | --- | --- |
| Mona A. | WhatsApp | فين الأوردر بتاعي؟ | #EO-48213 | Tracking | 4 min | Bot |
| Karim H. | Instagram | Size exchange please | #SH-10992 | Exchange | 22 min | Nour |
| Sara M. | Email | Refund not received | #WC-3381 | Refund | Breached | — |

_Sample data. Full visual in `design/prototype.html`._

## Rules — Routing

| Condition | Route | Note |
| --- | --- | --- |
| VIP segment | Senior agents | Priority |
| Topic = refund / dispute | Finance-trained team | — |
| Language = English | English team | Detected |
| Outside hours | Bot + 'we reply at 10:00' | — |
| New customer, order in last 7 days | Delivery team | Most questions are 'where is it' |
| Sentiment negative | Senior agent + manager alert | AI-detected |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Business hours | 10:00–22:00 |
| First response SLA | 15 min |
| AI replies | Draft only (agent sends) |
| CSAT survey | On |
| Auto-close resolved after | 48 hours of no reply |

> AI replies start in draft mode; a tenant can allow auto-send for selected topics once accuracy is reviewed.

## Events emitted

| Event | Meaning |
| --- | --- |
| `conversation.created` | New conversation |
| `conversation.sla_breached` | SLA missed |
| `conversation.resolved` | Resolved |
| `csat.received` | Rating received |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `conversation.assign` | Assign |
| `conversation.reply` | Send a reply or template |
| `conversation.tag` | Tag topic |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Full | Full | Full |
| Agent | Partial | Full | — |
| Warehouse | — | — | — |
| Finance | Partial | — | — |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Unknown sender | New contact; agent links to customer |
| Outside WhatsApp 24 h window | Only approved templates can be sent |
| Same customer on two channels | Merged into one customer timeline |
| Customer asks about an order from another store | All tenant stores searched; agent picks |
| Angry or abusive message | Flagged to manager; AI never auto-replies |

## Acceptance criteria

- [ ] Messages from all connected channels appear in one queue within 10 s.
- [ ] Each conversation shows the customer's last orders and their status.
- [ ] WhatsApp outside the 24 h window only offers approved templates.
- [ ] SLA timers respect business hours.
- [ ] Bot-to-agent hand-off keeps the full history.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/conversations` | Queue |
| POST | `/v1/conversations/{id}/messages` | Reply |
| PATCH | `/v1/conversations/{id}` | Assign, tag, resolve |
| GET | `/v1/saved-replies` | Saved replies |
| POST | `/v1/conversations/{id}/handoff` | Bot to agent hand-off |

Conventions: `docs/05-api.md`.

## Entities

`Conversation`, `Message`, `Channel`, `SavedReply`, `SlaPolicy` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Instagram and Messenger in V2 or later?
- AI auto-send allowed for which topics?
- Phone calls logged into the same timeline (V3)?
