# M7 — Ad-to-cash attribution · ربط الإعلانات بالكاش

> **Phase:** V2 · the moat · **Depends on:** M1 Orders, M2 Confirmation, M3 Shipping, M5 Profit  
> **Estimate:** 4 sprints — 2 backend + 1 frontend. Each platform's review and app approval runs in parallel.

_Stop paying for orders that never pay. Teach the ad platforms who really buys._

## Purpose

Attribution links ad spend to the orders it produced, then follows those orders to delivery. It shows cost per delivered order and delivered ROAS per campaign and creative — and sends confirmed and delivered events back to Meta, TikTok and Snap, so their algorithms learn from real buyers instead of fake COD orders.

## Users

| User | Uses it to |
| --- | --- |
| Media buyer | Scales winners, kills fake-order campaigns |
| Owner | Sees which ads make profit |
| Brandita account team | Reports real results to clients |
| Ops manager | Sees which campaigns bring risky orders |

## Success metrics

| Metric | Definition |
| --- | --- |
| Delivered ROAS | Delivered revenue ÷ ad spend |
| Cost per delivered order | Spend ÷ delivered orders |
| Fake-order share by campaign | Cancelled or refused ÷ orders |
| Event match quality | Share of events matched by platforms |

## Flow — Spend in, cash out — and the truth **sent back to the platforms**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Import spend | Daily spend per campaign, ad set and ad from each platform API. | Automatic |
| 2 | Capture source | UTMs, click IDs (fbclid, ttclid, ScCid) and pixel IDs stored on the order. | M1 |
| 3 | Match | Each order tied to its ad; unmatched orders marked organic or unknown. | Automatic |
| 4 | Follow to cash | Confirmation, delivery and refusal outcomes flow in from M2 and M3. | Automatic |
| 5 | ⭐ Send back | Confirmed and delivered events sent server-side to each platform. | Automatic |
| 6 | Decide | Campaigns ranked by delivered ROAS and profit per order. | Media buyer |

- **Why it matters.** Platforms optimize for whoever 'purchased'. With COD, many purchases are fake. Sending delivered events teaches them to find real buyers.
- **Privacy-safe.** Customer data sent back is hashed (phone, email) as each platform's conversion API requires.
- **Honest gaps.** Orders with no source are shown as unattributed — never forced onto a campaign.

## Main screen — Campaigns · last 14 days

Filters: `All platforms` · `Meta` · `TikTok` · `Snap` · `Google`  
Actions: Connect platform, Export

| Campaign | Spend | Orders | Delivered | Cost / deliv. | Deliv. ROAS |
| --- | --- | --- | --- | --- | --- |
| Spring serum · broad | EGP 22k | 410 | 301 | 73 | 4.6× |
| Air fryer · lookalike | EGP 18k | 190 | 92 | 196 | 2.1× |
| Retargeting 30 d | EGP 9k | 160 | 141 | 64 | 5.2× |
| TikTok · creators | EGP 15k | 380 | 121 | 124 | 1.4× |
| Snap · KSA launch | SAR 6k | 88 | 70 | 86 | 3.3× |

_Sample data. Full visual in `design/prototype.html`._

## Conversion events by payment method

Ad platforms learn from the moment money is real, which depends on how the customer paid.

| Payment method | Event sent | When | Value |
| --- | --- | --- | --- |
| Cash on delivery | Purchase (delivered) | On delivery | Delivered amount |
| Card, wallet, BNPL | Purchase | On capture | Captured amount; refunds sent as adjustments where supported |
| Bank transfer | Purchase | On match | Matched amount |
| Any method, refused or refunded | No purchase, or a refund event | On refusal or refund | Removes the order from optimisation |
| Marketplace, POS | Not sent | — | Excluded unless matched by click ID |

## Rules — Attribution and event rules

| Rule | Default |
| --- | --- |
| Attribution source order | Click ID, then UTM, then pixel, else unattributed |
| Attribution window | 7-day click, 1-day view (platform setting) |
| Spend allocation | Spend ÷ delivered orders of that campaign |
| Event sent on confirm | 'Confirmed purchase' custom event |
| Event sent on delivery | Purchase with delivered value |
| Refused or cancelled | No purchase event; optional negative signal |
| Deduplication | Same event ID as the browser pixel |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Platforms connected | Meta, TikTok, Snap, Google |
| Send events | Confirmed + delivered |
| Delivery event delay | Within 1 hour |
| Hash customer data | Always |
| Fake-order alert | Above 50% per campaign |

> Event names and parameters follow each platform's current conversion API. Confirm the exact schema with each platform during build.

## Events emitted

| Event | Meaning |
| --- | --- |
| `attribution.spend_imported` | Daily spend loaded |
| `attribution.campaign_alert` | Fake-order share or ROAS crossed a threshold |
| `capi.event_sent` | Conversion event accepted by a platform |
| `capi.event_failed` | Platform rejected an event |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `capi.send_event` | Send a custom conversion event |
| `report.campaign_digest` | Send the daily campaign digest |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Full | — | — |
| Agent | — | — | — |
| Warehouse | — | — | — |
| Finance | Full | — | — |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Order has no UTM or click ID | Shown as unattributed; never guessed |
| Platform token expires | Owner asked to reconnect; events queued for 7 days |
| Event rejected | Logged with reason; retried after fix |
| Spend in another currency | Converted at the day's rate |
| Order delivered after the window | Delivered event still sent if platform accepts |
| Same order clicked two ads | Last click wins by default |

## Acceptance criteria

- [ ] Delivered ROAS per campaign matches a manual check on pilot data.
- [ ] Delivered events reach Meta within 1 hour.
- [ ] All customer data sent is hashed.
- [ ] Unattributed orders are visible, never hidden.
- [ ] A campaign over the fake-order threshold raises an alert.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/ad-accounts` | Connect a platform account |
| GET | `/v1/attribution/campaigns` | Campaign results |
| GET | `/v1/attribution/ads/{id}` | Ad-level detail |
| POST | `/v1/capi/replay` | Re-send failed events |
| GET | `/v1/capi/log` | Event delivery log |
| PUT | `/v1/settings/attribution` | Windows and rules |

Conventions: `docs/05-api.md`.

## Entities

`AdAccount`, `AdSpend`, `Attribution`, `CapiEvent` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Platform app approvals: which business account owns them?
- Send a negative signal for refused orders?
- Include Google Ads in V2 or later?
