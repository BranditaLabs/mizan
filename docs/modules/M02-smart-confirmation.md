# M2 — Order verification and confirmation · التحقق من الأوردرات وتأكيدها

> **Phase:** MVP · **Depends on:** M1 Orders, M14 Scripts, M11 Risk network, M13 Automations  
> **Estimate:** 3 sprints — 2 backend + 1 frontend. WhatsApp Business API approval runs in parallel.

_Every order is checked the cheapest safe way: COD orders are confirmed, prepaid orders are screened for fraud._

## Purpose

Verification scores every order 0–100 and picks how to check it. Cash-on-delivery orders are confirmed by auto-rules, a WhatsApp bot or an agent before they ship. Prepaid orders (card, wallet, BNPL, bank transfer) skip confirmation but go through fraud and chargeback screening, address verification and, for high-value or mismatched orders, a manual review. The goal is the same for every payment method: ship only orders that will be delivered and kept.

## Users

| User | Uses it to |
| --- | --- |
| Agent | Works the call queue, logs outcomes |
| Ops manager | Tunes thresholds, watches rates |
| Owner | Sees confirmation and delivery rates |
| Customer | Confirms by WhatsApp in their dialect |

## Success metrics

| Metric | Definition |
| --- | --- |
| Confirmation rate | Confirmed ÷ (confirmed + cancelled), per route and per answering channel; orders not answered yet are shown apart (✅ E6-6, Settings → Confirmation → Results) |
| Auto-confirm share | Confirmed without a human |
| Time to confirm | Order created to confirmed: the median, for orders that were asked (auto-confirmed left out) |
| Delivered after confirm | Proof the score works |

## Flow — Score, route, confirm, and **learn from every delivery**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | ⭐ Score the order | Customer history, duplicates, address quality, value, phone validity, risk network. | Automatic |
| 2 | Pick the route | Thresholds map the score to auto, bot, agent or hold. | Automatic |
| 3 | WhatsApp bot | Order summary, Confirm / Change / Cancel buttons, location pin request. | Customer |
| 4 | Agent call | Click-to-call with the script from M14; outcome code logged. | Agent |
| 5 | Retry or close | No answer retries on a schedule; then cancel or hold. | Automatic |
| 6 | Learn | Delivery outcome feeds back to tune the score. | Automatic |

- **Explainable.** Every score shows its top three reasons, so agents trust it and owners can tune it.
- **Fallbacks.** Bot no reply in 2 hours moves the order to the agent queue automatically.
- **Fair load.** Orders are spread across online agents by queue size and language.

## Automated confirmation (built, E6-7 · in the chat, E6-10)

Every new cash-on-delivery or deposit order (placed in the last 24 hours, never imported history) becomes **Waiting to confirm** and walks the store's cascade without anyone touching it. Default:

1. **WhatsApp** — the approved template with three buttons: **أكّد الأوردر / عايز أعدّل / ألغي الأوردر**. No link to open: the customer answers by tapping, inside the chat (wait 2 h).
2. **Our team calls** — the order goes on the **"محتاج مكالمة" (Needs a call)** list, with a call script; outcomes Confirmed / No answer / Cancelled. "No answer" hides the order until the retry time (default 3 tries, 1 h apart, calling hours only), then it stays on the list marked unreachable.

An **automated call** (IVR, "press 1 to confirm…") can sit between them once a voice vendor is connected (E6-8). The team call, when present, is always last. SMS is no longer offered (settings saved before read `sms` as skipped and `voice` as the automated call).

### The conversation (E6-10)

```
Template  [أكّد]  → order Confirmed → "تمام ✅ أوردرك … اتأكّد وهنشحنه قريب"
          [عدّل]  → on the call list (change requested) → "اكتب لنا التعديل…" → what they type next is the note (encrypted) → "وصلنا ✍️"
          [ألغي]  → a list: reasons + "لا، كمّل الأوردر" → a reason cancels ("اتلغى أوردرك…"); keep confirms
Anything typed → on the call list (customer_message) → "وصلنا ✍️ فريق المتجر هيكلّمك"
A location     → kept on the order for the courier
```

- **Signed buttons.** Each button and list row carries `c1.<run>.<action>[.<arg>].<mac>` (HMAC with `LINK_SIGNING_KEY`): a forged or edited id does nothing; a tap on an old message only touches its own order; a second tap or a redelivered webhook changes nothing ("late").
- **Replies are queued steps** (`kind = reply`) sent by the runner, keyed by the customer's message id: never sent twice.
- **Delivery statuses** (sent, delivered, read, failed) build the transcript on the order card. A failed template (number not on WhatsApp, 131026) moves the cascade on immediately.
- **No idempotency key at Meta:** a send whose response is lost waits 10 minutes for its status webhook (our key in `biz_opaque_callback_data`); found → recorded as sent; none → sent again, once.
- **Utility vs marketing:** the template stays pure utility (no promotion). Upsell offers (E6-11) go as a follow-up inside the free 24-hour window that the customer's tap opens.

### Templates (submit in WhatsApp Manager, category Utility)

`mizan_order_confirm_ar` — body: `{{1}} 👋` / `أوردرك رقم {{3}} من {{2}} وصلنا.` / `الإجمالي {{4}}.` / `أكّد الأوردر عشان نجهّزه ونشحنه لك.` — quick replies in order: أكّد الأوردر · عايز أعدّل · ألغي الأوردر.
`mizan_order_confirm_en` — body: `{{1}} 👋` / `We received your order {{3}} from {{2}}.` / `Total: {{4}}.` / `Please confirm so we can prepare and ship it.` — quick replies: Confirm order · I want a change · Cancel order.
Parameters: 1 greeting with first name, 2 store name, 3 order number, 4 amount ("1,250 ج.م. عند الاستلام"). The store's language decides which one is sent; the connection is **active** only when that one is approved.

### Connecting the number

Settings → Confirmation → the store's WhatsApp number (owner, admin): Phone number ID, WhatsApp Business Account ID and a permanent system-user token (stored encrypted). Checked in the background: active, or needs attention (`token_refused`, `token_lacks_permission`, `template_pending`, `template_rejected`, `template_missing`) with what to do. Embedded Signup (one click, E6-4b) replaces the form once Meta approves Mizan as a Tech Provider. Everything to set up at Meta: `docs/needed-from-you.md` §1.

### Consent: STOP and START (E6-4b)

Meta's policy: message customers who agreed, and honour an opt-out. A customer who replies or taps in the chat has opted in (`customers.whatsapp_opt_in`, `opt_in_at`, `opt_in_source = whatsapp_reply`). One who writes **STOP** alone (also `unsubscribe`, «إيقاف», «وقف», «وقف الرسايل», «إلغاء الاشتراك»; spelling, hamza and diacritics don't matter) has opted out (`whatsapp_opt_out_at`): the running confirmation goes to the team's calls (reason `opted_out`), they get one free-form answer in the open chat, and every later confirmation skips WhatsApp for them (step `skipped`, "customer opted out") and goes to the next channel, usually the team's call. **START** («ابدأ») clears it. A longer message containing "stop" is a message to the team, not an opt-out. The opt-out is kept for a number that never ordered, so it holds when they do. The order screen says when the customer has opted out; the customer export (privacy) includes it. Consent collected at checkout (`opt_in_source = checkout`) waits for a store setting and Meta's guidance on wording.

The **link page** (`/c/{token}`) stays for stores without a WhatsApp number: the team sends it by hand (wa.me, prefilled) or copies it. Every channel answers through one service (`applyAnswer`): the order becomes Confirmed or Cancelled, the timeline and attempts log record who and how, a second answer is refused.

### Offers: upsell and cross-sell (E6-11)

One offer per confirmation, chosen when the run starts (so it is ready the moment the customer confirms, and in the team's script):

1. **The owner's rules** (Settings → Offers): "if the order has *Abaya* → offer *Matching scarf* at 10% off", or for any order; a rule for the order's product beats a rule for any order, then priority. Optional own wording.
2. **Otherwise Mizan's suggestion**: what customers of this store bought with these items (last 180 days), then what sells most (90 days), then the margin.
3. **Never**: something already in the order, sold out, an archived product, more than 60% of the order total, sold at a loss after the discount (when its cost is known), or a discount above the store's maximum (default 15%; suggestions 10%).

The customer sees it **in the thank-you message** right after tapping Confirm, with two buttons:

```
تمام ✅ أوردرك #1042 اتأكّد.

🎁 عرض ليك: طرحة مطابقة بـ 135 ج.م. بدل 150 ج.م.
تحب نضيفه لنفس الأوردر؟          [ ضيفه ]  [ لا شكراً ]
→ "تمام ✅ هنضيف طرحة مطابقة لأوردرك، والإجمالي الجديد 1,385 ج.م."   or   "ولا يهمك 🙏 أوردرك ماشي زي ما هو."
```

It goes inside the free window the customer's tap opened, so the template stays utility. On a team call the script ends with the offer, and the order card has "Customer accepted / Not interested". The price recorded is the price shown, never more; an offer ends when the order ships or after 48 hours. Off by default; the owner turns it on. Accepting records the offer (`offer.accepted`) and Mizan adds it to the Shopify order (E6-13): one engine job per offer (`shopify.addOffer`, key `shopify:offer:<id>`) reads the order first (tag `mizan-offer-<id>` or the line already there = done), then `orderEditBegin` → `orderEditAddVariant` → `orderEditAddLineItemDiscount` (the offer's %) → `orderEditCommit` (customer not notified by Shopify), verifies a commit whose answer was lost by reading the order again (never commits twice), then tags it. The order is read back, so its total, the cash to collect and profit include the new line. The offer becomes `applying` → `applied`, or `failed` with a reason the card spells out: not in a connected store (manual order, unlinked product: fails at once, no job), unavailable (sold out, removed, order cancelled), permission (store must reconnect for `write_order_edits`), or failed; the team adds it by hand. A customer who accepted in the chat gets "we couldn't add it, the team will call you". **Shipping waits** while an order's offer is `accepted` or `applying` (E7-1). Settings → Offers also shows offers made, accepted and the sales they added (30 days).

### Claude picks and words the offer (E6-12)

With **"Let AI choose and write the offer"** on (Settings → Offers; needs `ANTHROPIC_API_KEY` on the platform), each offer gets a queued `ai_offer` step at the start of confirmation. Claude (`claude-opus-5-5` by default, `ANTHROPIC_MODEL`; low effort; structured JSON output; `fallbacks: "default"`) sees the store's name, the order's items, and Mizan's shortlist (up to 5 items that already passed every guard: title, price, margin band high/medium/low/unknown, bought-together and popularity counts) and returns `{ id, discountPct, messageAr, messageEn }` with `{price}` where the price goes. Mizan then:

- accepts only an item from the shortlist and a whole discount within the store's maximum; re-checks every guard (stock, no loss, ≤ 60% of the order) and computes the price itself;
- keeps an owner's rule as it is (item and discount), using Claude only for its wording when the owner wrote none;
- applies nothing if the customer has already been shown the offer, if Claude refused or was cut off, if the answer has a link or a phone number, or if Claude is down after 3 tries: Mizan's own offer and wording stay.

No customer name, phone or address is ever sent. Metrics: `mizan_ai_offer_total{result}` (picked, worded, refusal, invalid, unsafe, error, late, retry) and `mizan_ai_tokens_total{kind}`.

**Next:** automated calls (E6-8), then an **AI voice agent** (E6-9, V2).

## The store's script (built, E6-5)

Since E6-16b this is edited in the **Confirmation studio** (below). Originally (E6-5), Settings → Confirmation → **Script**: the store's own wording for what the customer reads after each button — Confirm (the confirmed reply, before any offer), Change (the prompt and the "received"), Cancel (the question before the reasons list, and the cancelled reply) — and for the team's call script (a line per line; the offer is still added at the end). Variables come from the order and never include the address or phone: `{{customer.first_name}}`, `{{order.number}}`, `{{order.total}}`, `{{order.cod}}` (what they pay on delivery, else the total), `{{order.items}}`, `{{order.city}}`, `{{store.name}}`; an unknown one is refused. A language pack gives the starting wording — **Egyptian Arabic** (the built-in messages) or **formal Arabic** — and a box left empty keeps the pack's. **Preview** fills the draft from a sample order (or one of the store's orders through the API) before saving. The first WhatsApp message stays the Meta-approved template.

### Every chat word editable (API and data, E6-16a)

Since E6-16a every word the buyer reads in the chat after the template is a **key** of the store's script (`confirmation/script/catalogue.ts`, served by `GET /v1/settings/confirmation/script-catalogue`). The owner edits them in the Confirmation studio (E6-16b).

- **Keys, in groups:** Confirmation (`confirmed`, `confirmed_offer_top`), Change (`change_prompt`, `change_received`), Cancel (`cancel_prompt`, `cancel_button`, `cancel_header`, `cancel_section`, `keep_title`, `keep_description`, `cancelled`), Offer (`offer_pitch`, `offer_question`, `btn_offer_yes`, `btn_offer_no`, `offer_added`, `offer_added_generic`, `offer_failed`, `offer_failed_generic`, `offer_declined`, `offer_expired`), Summary and after (`summary_pay`, `summary_paid`, `summary_more`, `summary_area`, `noted`, `already`), System (`opted_out`, `opted_in`, `on_delivery`, `footer`, `link_text`), Calls (`call`). Each has a kind and a limit: texts and bodies 1,000; the offer message's top 400, pitch 300, question 200; summary lines 80; buttons and the list button 20; rows and the section 24; a row's description 72; header and footer 60; `on_delivery` 30; `call` 2,000. Header, section, footer and the keep row's description are optional: left empty, that part is left out.
- **Variables** (each key allows its own): `customer.first_name` (cut to 20), `customer.greeting` (the pack's "أهلاً منى" / "أهلاً بيك"), `order.number`, `order.total`, `order.due`, `order.cod`, `order.items`, `order.city`, `store.name`, `offer.title`, `offer.line`, `offer.new_total`, `summary.due`, `summary.more`, `link`, `start_keyword` («ابدأ» / START). Never the address or the phone; the city is the deliberate minimum (docs/07). A value ending in "." swallows the text's next "." (no "ج.م..").
- **Packs:** `egyptian` (the chat's original wording, word for word), `formal` (Modern Standard Arabic, now complete for every key) and `gulf` (Saudi and Gulf Arabic). Packs are Arabic dialects only: English is the same in every pack. Each pack has its five cancel reasons and its greeting.
- **Cancel reasons:** the store may list 1–9 of its own (`cancelReasons`), each with an id, one of the five canonical codes (`changed_mind`, `ordered_by_mistake`, `found_cheaper`, `delivery_too_late`, `other`), a title per language (the store's language required; the other falls back to the pack's title for the code) and an optional description; "keep my order" is always the last row. The row's signed argument carries the code (`4-wrong_size`), so a reason renamed or deleted after the send still cancels with its code; a pack reason is sent as the bare code, as before. The cancel records the code as `reason` and the store's id as `cancelReasonId`.
- **Rules on save** (422 with the path, e.g. `script.texts.en.btn_offer_yes`, `script.cancelReasons.3.title.ar`): too long (variables counted at their width, the store's name at its real length), an unknown variable or one the key does not allow, a required variable missing (`{{link}}` in `link_text`, `{{start_keyword}}` in `opted_out`, the summary's amount, count and city), only variables, a variable in a title, a new line in a title, fragment, header or footer, a link in a title, `on_delivery`, `opted_out`, `opted_in`, header or footer, `on_delivery` unsafe for the approved template (a link, a phone number, an emoji, a tab or 4 spaces), two equal titles (after the pack fills in) or ids. Saved scripts are `version: 2`.
- **When sending,** every key is fitted to its limit: the items are shortened first, then the pack's text is used, then the text is cut on a grapheme with "…" (never inside a link, never empty). A stored script is read tolerantly: a key it does not know or a text with a variable that key cannot use is dropped; a text that grew too long (the store was renamed) is kept and fitted, and `GET /v1/settings/confirmation` reports it in `scriptIssues`. Until the owner writes `noted`, typed messages get their own "change received" text (as before E6-16a, so one edit still changes both), and a broken script never resets the steps or calling hours. Saving never fails on a text that only got too long since it was stored: it stays in `scriptIssues` and is fitted when sent.
- **Composed in code, not editable as one string:** the Meta templates and their parameters (only the pack's greeting and the checked `on_delivery` flow in), the summary's structure (only its labels are keys), the offer line's format, money (Arabic currency names: ج.م.، ر.س، د.إ، د.ك، ر.ق، د.ب، ر.ع, not the new riyal sign), the reason list's shape, the call script's built-in lines (`call` left empty) and the IVR prompts.
- **The approved Arabic template stays Egyptian** ("أوردرك… وصلنا… عشان نجهّزه"): with the gulf pack a KSA buyer reads an Egyptian first message, then Gulf replies. Rewording `mizan_order_confirm_ar` in neutral Arabic before the first submission is the owner's decision.

## Confirmation studio (built, E6-16b)

Settings → Confirmation → **Studio** (`/settings/confirmation/studio`, `confirmation.manage`): the buyer's WhatsApp confirmation as a flow anyone can build, with the result on a WhatsApp phone. Settings → Confirmation keeps the switch, the channels, the WhatsApp number, routing by risk and the hand-sent link's hours, and links to the studio with a summary of the steps ("WhatsApp → team call"); the steps, team calls, calling hours and the script live only in the studio, so two editors never fight over them.

- **The flow**, read top to bottom: *a new order arrives* (on/off, from Settings → Confirmation) → the **steps**, sortable by drag and drop (pointer and touch with dnd-kit; on the keyboard Space or Enter lifts, the arrows move, Space or Enter drops, Escape puts it back, announced in Arabic or English), each with "if no answer in N minutes → next step" (10–1440), a *not connected* badge, and Move up / Move down / Remove in its menu. A **palette** (WhatsApp message, automated call, team call) adds a step by dragging it into the flow or tapping it; at most six steps; the team call is pinned last and only once. The rules are the API's (`studio/flow.ts`).
- **What the buyer can do**, under the first WhatsApp step: *confirms* (then the offer if one applies, then a link to After confirmation with its summary), *asks for a change*, *cancels*, *writes a message*, *answers again*, *says STOP or START*, and *every message* (footer, the words inside the template, the hand-sent link). Each node shows its current first line, *your words* when the owner changed any of its keys and a red dot when one has a problem. The team call node holds the call script, tries, retry time and calling hours. Keys go to nodes by their catalogue group (one table), so a new key lands in its node without screen work.
- **The inspector** under the flow edits the selected node's keys in catalogue order: a label and hint per key, the pack's text as the placeholder (composed keys: "Mizan writes this from the order"; optional ones: "leave empty to leave it out"), the allowed variables as chips (drag one into the text, or tap to put it at the caret), a live `estimated / limit` counter counted like the API (`studio/length.ts`), required variables named when missing, and every problem from the preview or a refused save in words, at its field. The cancel node edits the store's reasons (sortable; title ≤ 24, description ≤ 72, the reason code; 1–9; "use the style's reasons"); with none of its own the store sees the style's five and a *Customise* button that copies them in. A reason needs a title in both languages when the other language would fall back to the style's title for the same code (the API refuses two equal titles).
- **The toolbar:** the wording style (Egyptian, formal Arabic, Gulf), the buyer's language (which texts are edited and which language the phone speaks), "restore the style's wording" for that language, and the problem count (opens the first one).
- **The phone** (`studio/WhatsAppPhone.tsx`) draws WhatsApp as the buyer has it, light and dark with the app, mirrored in Arabic: the business header (no verified mark), wallpaper, the approved template with its quick-reply buttons and an *approved template* lock, interactive buttons, the list with its bottom sheet (rows, descriptions, radio, Send), the buyer's taps and words, ticks and times, WhatsApp formatting (`*bold*`, `_italic_`, `~strike~`, ` ```mono``` `, links that never navigate), parsed into React nodes, never HTML. WhatsApp's own words (Today, typing…, Message, Send) come in the buyer's language from that language's messages file. It follows the draft about 350 ms after an edit (`POST …/preview`), keeping the old chat while the new one loads.
- **Simulation:** the phone starts with the template alone; tapping a button plays that branch with a short "typing…" (none with reduced motion): Confirm (with the *with an offer* switch: the offer, then Yes → added, No thanks → `offer_no`), Change (then the sample answer from the composer), Cancel (the list sheet, any reason, Send), and from the composer a question, STOP or START; Cancel after confirming answers "already". A menu jumps to any scenario whole, *restart* goes back. The position survives each refresh, so typing never resets the chat. A business bubble opens its text in the inspector, and the text being edited is ringed on the phone. Selecting the team call shows the call script as a call screen; editing the hand-sent link shows that message as the team member sends it.
- **Saving** sends the whole settings (other fields as they are); a 422 is mapped to its node and field (texts, reasons, steps, team call) and the draft stays. Leaving with changes asks first. Below 1280 px wide the phone opens as a sheet from a floating "Preview on WhatsApp" button.
- **Stays fixed:** the Meta-approved template (shown, not editable), money and the summary's structure, the offer line's format, the IVR prompts. Sending a test to the owner's own WhatsApp is E6-16c.

## Main screen — Confirmation queue

Filters: `My queue · 38` · `Bot waiting · 112` · `Retry due · 14` · `On hold · 9` · `Done today · 287`  
Actions: Pause bot, Start calling

| Order | Customer | Score | Why | Route | Attempts |
| --- | --- | --- | --- | --- | --- |
| #WC-3381 | Sara M. | 78 | New phone, high value | Agent | 1 / 3 |
| #EO-48213 | Mona A. | 54 | Address unclear | Bot | Sent |
| #SH-10999 | Omar T. | 91 | Refused 3× elsewhere | Hold | — |
| #EO-48220 | Hana S. | 12 | 4 past deliveries | Auto | — |
| #LF-781 | Tarek F. | 61 | No reply to bot | Agent | 0 / 3 |

_Sample data. Full visual in `design/prototype.html`._

## Verification by payment method

| Payment method | Check | Typical route |
| --- | --- | --- |
| Cash on delivery | Confirmation (real order? right address? right items?) | Auto / WhatsApp bot / agent / hold |
| Deposit + COD balance | Deposit paid › light confirmation of the balance | Auto or bot |
| Card, wallet, Apple Pay | Fraud screening: velocity, mismatched names and addresses, high value, risky BIN or country, past chargebacks | Auto-approve or manual review |
| BNPL (Tabby, Tamara, valU) | Provider carries credit risk; check address and stock only | Auto |
| Bank transfer / InstaPay | Hold until payment is matched (M15); remind customer | Hold › auto when paid |

The risk score is one model with method-specific signals. Reasons are always shown. ✅ E6-1: `scoreOrder` (orders module) runs as the order arrives; the order screen shows the score and its top three reasons (AR/EN); routing by band is E6-2.

## Rules — Default score factors and routes

| Signal | Effect on score | Source |
| --- | --- | --- |
| Past delivered orders | Lowers, per delivery | Customer history |
| Past refusals | Raises sharply | History + M11 network |
| Duplicate in 48 h | Raises | M1 |
| Address incomplete, no pin | Raises | Address check |
| Order value far above store average | Raises | Order |
| Invalid or new phone | Raises | Phone check |
| Score 0–25 · 26–60 · 61–85 · 86+ | Auto · Bot · Agent · Hold | Route thresholds (✅ E6-2: Settings → Confirmation → Route by risk, off by default) |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Auto-confirm below | Score 25 |
| Hold above | Score 85 |
| Bot timeout | 2 hours |
| Agent retries | 3 over 24 hours |
| Calling hours | 10:00–22:00 local |
| Location pin | Requested if address weak |

> Weights start from defaults and are tuned per merchant on real delivery outcomes. Thresholds are proposals to validate in the pilot.

## Events emitted

| Event | Meaning |
| --- | --- |
| `confirmation.scored` | Score and reasons calculated |
| `confirmation.routed` | Route chosen: auto, bot, agent, hold (✅ E6-2) |
| `confirmation.confirmed` | Order confirmed, by which route |
| `confirmation.no_answer` | Attempt failed, retry scheduled |
| `confirmation.cancelled` | Customer or agent cancelled |
| ✅ `confirmation.started`, `confirmation.sent`, `confirmation.escalated` | E6-7: a run started, a message or call went out, the order went to an agent (no reply, no channel, change requested) |
| ✅ `order.confirmed`, `order.confirmation_failed` | E6-7: answered by any channel (`channel` in data) |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `confirmation.send_bot` | Send the WhatsApp confirmation |
| `confirmation.to_agent` | Push into an agent's queue |
| `confirmation.hold` | Hold for manual review |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Full | Full | Full |
| Agent | Partial | Partial | — |
| Warehouse | — | — | — |
| Finance | Full | — | — |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Customer replies by voice note | Order moved to agent queue with the note attached |
| Customer changes items in chat | Bot offers Change; agent edits and re-confirms |
| Wrong number | Outcome logged; order cancelled; number flagged |
| Agent goes offline mid-queue | Their orders return to the shared queue |
| WhatsApp template rejected | Falls back to SMS link, then agent call |
| Customer confirms twice | Second reply ignored, no duplicate status |

## Acceptance criteria

- [ ] Confirmation rate is shown separately for auto, bot and agent.
- [ ] Every score shows its top three reasons.
- [ ] Bot no-reply moves the order to an agent after the timeout.
- [ ] Retries follow calling hours in the customer's time zone.
- [ ] A held order cannot ship until released.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/confirmation/queue` | ✅ E6-3: the team's call queue counts (due now, mine, later, unreachable) |
| POST | `/v1/confirmation/queue/next` | ✅ E6-3: claim the next order to call (mine first, retries due, then new, unreachable last); web `/confirmation` |
| POST | `/v1/orders/{id}/score` | Recalculate the score |
| POST | `/v1/orders/{id}/attempts` | Log a call outcome |
| POST | `/v1/orders/{id}/bot` | Send WhatsApp confirmation |
| POST | `/v1/whatsapp/webhook` | Inbound replies |
| GET / PUT | `/v1/settings/confirmation` | ✅ E6-7: on/off, steps and waits, calling hours, link lifetime; connected channels |
| GET | `/v1/orders/{id}/confirmation` | ✅ E6-7: the run, steps, attempts |
| POST | `/v1/orders/{id}/confirmation/link` | ✅ E6-7: link + WhatsApp (wa.me) message to send by hand |
| POST | `/v1/orders/{id}/confirmation` | ✅ E6-7: agent records confirm / cancel |
| GET / POST | `/v1/public/confirm/{token}` | ✅ E6-7: the customer's link page (no sign-in) |
| GET | `/v1/confirmation/summary?days=7\|30\|90` | ✅ E6-6: rate, waiting on the team, median time to confirm, by route and by answering channel (counts only) |

Conventions: `docs/05-api.md`.

## Entities

`RiskScore`, `ConfirmationAttempt`, `QueueAssignment`, `WhatsAppMessage` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Click-to-call through which telephony provider?
- Score rules first, or a trained model from day one?
- Do agents need a mobile queue app?

## After confirmation (E6-23a)

What the store chose to happen after each outcome. Every action is off by default: a store that never opens the screen behaves as before.

| Outcome | The store can turn on | Always (fixed) |
|---|---|---|
| Confirmed | a change window (0–120 min: off pick lists and ready-to-ship, no booking); tags in Mizan and Shopify; a notice; automatic booking with a chosen Bosta connection, for chosen payment methods (never `unknown`) and ways of confirming (never an exchange), optionally after a change | the cash to collect is worked out when the courier job runs (`cashToCollect`); a customer who writes in the window holds the order for the team |
| Changed | tags, a notice, assign to a member | the team calls back and edits the order |
| Cancelled | tags, a notice | cancelled in the store; stock released |
| No answer | tags, a notice, cancel N hours after the messages or the team's last call went unanswered | never a paid, assigned (unless chosen), changed, held or high-risk order; Mizan holds no stock before confirmation |
| Opted out (STOP) | tags, a notice | the team calls; no messages |

**How.** The confirmation writes the hold and a `release` follow-up in its own transaction (`order_followups`, 0073). `FollowupsRunner` (in the confirmation runner's pass) fires due follow-ups: it releases the order and, when automatic booking applies, emits `order.ready_to_ship`; shipping's `AutoBookConsumer` books through `ShippingService.book()` after checking everything again. A refusal is `order.auto_ship_blocked` with a code and a notice: `payment_blocks_shipping`, `payment_mode_not_allowed`, `address_missing`, `no_courier`, `courier_needs_attention`, `store_not_connected`, `stock_short`, `duplicate_suspected`, `offer_settling`, `order_moved`. A payment or stock that arrives later re-arms it. `confirmation.no_answer` (stage `messages` after a real send nobody answered, or `team_calls` after the last unanswered call) schedules the automatic cancel, which runs `applyAnswer` as Mizan (reason `no_answer`), so the store's order is cancelled too. A setting turned off, or Book by hand, wins over follow-ups already waiting, even after the order was handed to shipping (`AutoBookConsumer` re-reads both). Stock not reserved yet waits (`stock_settling`); a deferral keeps the order held. A message counts as sent only when Meta did not report it failed; a customer who writes or says STOP afterwards stops the automatic cancel; Cancel or Change tapped inside the change window holds the order for a person. `confirmation.no_answer` goes out once per stage. After the team's last call, the caller's own assignment does not stop the cancel. Notices are stored as `kind|number|code` (source `after_confirmation`) and told in each reader's language by the bell; they carry the order number and a reason only.

**Known gaps (E6-23b and later).** The screen and the order card; the WhatsApp order summary; tags reach Shopify only for the store's own orders (not WooCommerce, not copies of orders made in Mizan); outcomes as managed automations in the Studio.
