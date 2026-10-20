# M11 — Regional risk network · شبكة تقييم المخاطر الإقليمية

> **Phase:** V3 · network effect · **Depends on:** M2 Confirmation, M1 Orders, M3 Shipping  
> **Estimate:** 3 sprints — 1 senior backend + security review. Needs enough opted-in merchants to be useful.

_One store's refused parcel warns every other store — without sharing anyone's data._

## Purpose

The risk network pools delivery outcomes across all opted-in Mizan merchants. When a new order arrives, M2 asks the network: has this phone number refused parcels elsewhere? The answer is a trust score, built from salted hashes and outcomes only — no names, no addresses, no store names ever shared.

## Users

| User | Uses it to |
| --- | --- |
| M2 Confirmation | Uses the score in every order |
| Owner | Opts in, sees network-flagged orders |
| Ops manager | Reviews held orders |
| Mizan team | Runs privacy and quality checks |

## Success metrics

| Metric | Definition |
| --- | --- |
| Network coverage | Share of new orders with network history |
| Refusals avoided | Held orders that would have been refused |
| False flags | Flagged customers who later accept delivery |
| Opt-in rate | Merchants contributing |

## Flow — Contribute outcomes, ask questions, **reveal nothing**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | ⭐ Hash | Phone normalized, then salted and hashed inside the merchant's tenant. | Automatic |
| 2 | Contribute | Outcome only: delivered, refused, fake — with a date and region. | Automatic |
| 3 | Aggregate | Signals summed per hash, per region, over a rolling window. | Network service |
| 4 | Ask | M2 sends the hash of a new order's phone; gets a score. | M2 |
| 5 | Decide | Score feeds the risk score; never blocks by itself. | M2 |
| 6 | Expire | Signals older than the window are deleted. | Automatic |

- **What is shared.** Salted phone hash, outcome, date, region. Nothing else — not the store, product, value, name or address.
- **What merchants see.** A score and a short reason, such as 'refused at 3 stores in 90 days'. Never which stores.
- **Legal first.** Launches only after legal review in each country, with opt-in terms and data kept in-region.

## Main screen — Network-flagged orders

Filters: `Flagged today · 23` · `Held · 9` · `Released · 14` · `Accepted later · 3`  
Actions: Network settings

| Order | Customer | Network signal | Store score | Final | Action |
| --- | --- | --- | --- | --- | --- |
| #SH-10999 | Omar T. | Refused 3 stores / 90 d | 40 | 91 | Held |
| #EO-48231 | Laila H. | Refused 1 / 90 d | 22 | 58 | Bot |
| #WC-3390 | Ali S. | Delivered 6 stores | 35 | 14 | Auto |
| #LF-790 | Karim B. | Fake number 2 stores | 50 | 88 | Held |
| #SL-5540 | Saad M. | No history | 30 | 30 | Bot |

_Sample data. Full visual in `design/prototype.html`._

## Rules — Privacy model

| Data | Shared to network? | Why |
| --- | --- | --- |
| Phone number | No — salted hash only | Cannot be reversed to a number |
| Delivery outcome | Yes | The signal itself |
| Date and region | Yes | Recency and residency |
| Store, product, order value | No | Commercially sensitive |
| Name, address, email | No | Personal data |
| Which stores reported | Never shown | Protects merchants |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Contribute outcomes | Opt-in, off by default |
| Use network score | On when opted in |
| Window | 90 days |
| Retention | 12 months, then deleted |
| Max effect on score | Capped weight |

> Hashing details (salt management, key rotation) and the legal basis per country must be reviewed by a security engineer and counsel before launch.

## Events emitted

| Event | Meaning |
| --- | --- |
| `network.flagged` | Network signal raised an order's risk |
| `network.contributed` | Outcomes contributed in a batch |
| `network.false_flag` | Flagged customer accepted delivery |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `network.lookup` | Get a score for a phone hash |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | — | Full |
| Ops manager | Full | Full | — |
| Agent | — | — | — |
| Warehouse | — | — | — |
| Finance | — | — | — |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Number reassigned to a new person | Old signals expire in the window; false-flag feedback lowers weight |
| Merchant opts out | Their past contributions deleted within 30 days |
| Malicious false reports | Per-merchant weight lowered if reports disagree with others |
| Country without legal sign-off | Network disabled for that region |
| Customer asks to be removed | All signals for that hash deleted |
| Network service down | M2 scores without it, logs the gap |

## Acceptance criteria

- [ ] No raw phone, name or store leaves a tenant.
- [ ] A number refused at 3 stores in 90 days is flagged high risk.
- [ ] Merchants never see which stores reported.
- [ ] Opt-out deletes contributions within 30 days.
- [ ] Signals older than retention are deleted automatically.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/v1/network/lookup` | Score for a hashed phone |
| POST | `/v1/network/contribute` | Batch of outcomes (internal) |
| PUT | `/v1/settings/network` | Opt in or out |
| DELETE | `/v1/network/subject` | Remove a subject's signals |

Conventions: `docs/05-api.md`.

## Entities

`NetworkSignal`, `NetworkScore`, `OptIn`, `SaltKey` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Legal basis per country (consent or legitimate interest)?
- Minimum merchants before turning it on?
- Show customers a way to dispute a flag?
