# M14 — Script Builder · منشئ السكريبتات

> **Phase:** MVP · grows in V2 · **Depends on:** M2 Confirmation, M9 CRM, M13 Automations  
> **Estimate:** 3 sprints — MVP: blocks, variables, branches, 1 dialect (2 sprints). V2: A/B tests and more dialects (1).

_What agents say and what the bot sends — built once, in every dialect, and measured on delivery._

## Purpose

Script Builder is where merchants write the confirmation conversation: the call script agents follow and the WhatsApp messages the bot sends. Scripts are made of blocks with variables and branches, come in each market's dialect, and are A/B tested on the number that matters — delivered orders.

## Users

| User | Uses it to |
| --- | --- |
| Ops manager | Writes and tests scripts |
| Agent | Follows the script during calls |
| Brandita copy team | Writes dialect versions for clients |
| Owner | Approves what customers receive |

## Success metrics

| Metric | Definition |
| --- | --- |
| Confirmation rate per script | By version and dialect |
| Delivered rate per script | The real winner metric |
| Drop-off block | Where conversations stall |
| Template approval time | WhatsApp review speed |

## Flow — Write blocks, add branches, pick dialects, **test on delivery**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Write blocks | Greeting, verify, ask, upsell, objection, close. | Ops / copy team |
| 2 | Add variables | Name, items, total, address, ETA — filled at send time. | Builder |
| 3 | Branch | Each answer leads to a block or an outcome code. | Builder |
| 4 | Dialects | One script, a variant per market; native review required. | Copy team |
| 5 | Approve templates | WhatsApp blocks submitted to Meta for template approval. | Automatic |
| 6 | ⭐ A/B and learn | Versions split traffic; winner chosen by delivered rate. | Automatic |

- **Call and chat from one source.** The same blocks render as an agent call guide and as WhatsApp templates with quick replies.
- **Outcome codes.** Every branch ends in a code (confirmed, changed, fake, no answer), which feeds M2, M10 and M5.
- **Measured on delivery.** A script that confirms more but delivers less loses. Winners are picked on delivered rate.

## Main screen

See `design/prototype.html` and the module page in the PDF book.

## Anatomy of a script

Scripts are built from **blocks**, not typed as one long text. Blocks make scripts reusable across stores, translatable into every dialect, and measurable: Mizan knows which block a conversation failed on. One script powers both channels: the call version shows agents what to say; the WhatsApp version sends the same blocks as approved templates with quick-reply buttons.

| Block | Does | Channel | Note |
| --- | --- | --- | --- |
| Greeting | Who is calling, from which store | Both | Builds trust in the first line |
| Verify order | Read back items, total, payment | Both | The core confirmation |
| Ask | Collect a detail: address, time, size | Both | Fills missing data |
| Branch | Route by the customer's answer | Both | Yes / change / no / no answer |
| Upsell | Offer an add-on, only if in stock | Both | Optional, A/B testable |
| Objection | Prepared answer to a common pushback | Call | "I didn't order", "too expensive" |
| Close | Confirm next step and delivery time | Both | Sets the outcome code |
| Handoff | Move from bot to a human agent | WhatsApp | Keeps the chat history |

## Variables

Filled from Mizan data at send time. A missing variable never sends a blank: the block falls back to a version without it.

| Variable | Source |
| --- | --- |
| `{{first_name}}` | Customer profile (M9) |
| `{{items}}` | Order lines (M1) |
| `{{total}}` | Order total, local currency |
| `{{address}}` | Normalized address |
| `{{eta}}` | Courier zone estimate (M3) |
| `{{agent_name}}` | Logged-in agent |
| `{{store_name}}` | Store settings |
| `{{upsell_item}}` | Rule: bought-together, in stock |

## Dialects — same line, six variants (block 2, "Is the order correct?")

| Dialect | Line |
| --- | --- |
| Egyptian | الطلب مظبوط كده؟ |
| Gulf (Saudi) | الطلب صحيح كذا؟ |
| Moroccan Darija | الطلب ديالك صحيح هكا؟ |
| Levantine | الطلب مزبوط هيك؟ |
| Iraqi | الطلب صحيح لو لا؟ |
| French (Maghreb) | Votre commande est-elle correcte ? |

⚠️ Dialect lines are drafts. Each must be written or checked by a native speaker from that market before going live.

### Block format (JSON stored in `scripts.blocks`)

```json
[
  { "id": "greet", "type": "greeting", "text": { "eg": "أهلاً {{first_name}}، معاك {{agent_name}} من {{store_name}}" } },
  { "id": "verify", "type": "verify", "text": { "eg": "طلبك: {{items}} بإجمالي {{total}}. الطلب مظبوط كده؟" },
    "buttons": [
      { "label": { "eg": "أيوه مظبوط" }, "next": "address", "outcome": null },
      { "label": { "eg": "عايز أغير" }, "next": "edit", "outcome": "changed" },
      { "label": { "eg": "ماطلبتش" }, "next": "close_cancel", "outcome": "cancelled_fake" }
    ] }
]
```

## Rules — Branching and outcome codes

| Customer says | Next | Outcome code |
| --- | --- | --- |
| Yes, correct | Address block, then close | confirmed |
| I want to change | Edit items, re-verify | changed › confirmed |
| I didn't order | Apologize, cancel | cancelled_fake |
| Too expensive | Objection block, offer prepaid discount | objection_price |
| Call me later | Schedule retry at the chosen time | rescheduled |
| No answer | Retry per M2 schedule | no_answer |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Default script per country | Required |
| A/B split | 50 / 50 |
| Winner metric | Delivered rate |
| Minimum sample | 300 orders per version |
| Opt-out line in marketing | Always added |

> WhatsApp business-initiated messages must use approved templates. Script Builder submits them, tracks approval, and blocks sending until approved.

## Events emitted

| Event | Meaning |
| --- | --- |
| `script.published` | New script version live |
| `script.block_dropoff` | A block's drop-off crossed a threshold |
| `template.approved` | Meta approved a WhatsApp template |
| `template.rejected` | Meta rejected a template, with reason |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `script.assign` | Use a script for a route or country |
| `whatsapp.send_template` | Send a script block as a message |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Full | Full | Full |
| Agent | Full | Partial | — |
| Warehouse | — | — | — |
| Finance | — | — | — |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Variable empty (no address) | Block falls back to its no-variable version |
| Template rejected by Meta | Previous approved version keeps sending |
| Customer writes free text | Keyword match; unclear replies go to an agent |
| Customer switches language | Next block sent in the detected language |
| A/B test too small | No winner declared until minimum sample |
| Agent goes off-script | Allowed; outcome code still required |

## Acceptance criteria

- [ ] One script renders as a call guide and as WhatsApp templates.
- [ ] Every branch ends in an outcome code.
- [ ] A/B winner is chosen by delivered rate.
- [ ] No template sends before Meta approval.
- [ ] Missing variables never produce blank text.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/scripts` | Scripts with versions and stats |
| POST | `/v1/scripts` | Create a script |
| POST | `/v1/scripts/{id}/versions` | Save a new version |
| POST | `/v1/scripts/{id}/templates/submit` | Submit WhatsApp templates |
| GET | `/v1/scripts/{id}/stats` | Rates by block and version |
| POST | `/v1/scripts/{id}/preview` | Render with a sample order |

Conventions: `docs/05-api.md`.

## Entities

`Script`, `ScriptVersion`, `Block`, `Branch`, `Variable`, `WaTemplate` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Which dialects at launch beyond Egyptian?
- Brandita writes scripts for clients as a paid service?
- Voice bot reading scripts in V3?
