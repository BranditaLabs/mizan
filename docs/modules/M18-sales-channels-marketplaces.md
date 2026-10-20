# M18 — Sales channels and marketplaces · قنوات البيع والماركت بليس

> **Phase:** V2 · **Depends on:** M1 Orders, M4 Warehouse, M5 Profit, M8 Reconciliation  
> **Estimate:** 4 sprints — About 1.5 sprints per marketplace; access reviews run in parallel.

_Sell on your store, Amazon, Noon and Jumia from one catalog and one stock count._

## Purpose

Channels publishes products from Mizan's catalog to marketplaces and keeps stock and prices in sync, so one stock count serves every channel. Marketplace orders flow into M1 like any other order, and marketplace fees and payouts flow into profit (M5) and reconciliation (M8).

## Users

| User | Uses it to |
| --- | --- |
| Owner | Channel mix and profit |
| Ops manager | Listings, stock buffers |
| Finance | Marketplace payouts |

## Success metrics

| Metric | Definition |
| --- | --- |
| Revenue and profit by channel | Net of fees |
| Listing errors | Rejected or suppressed listings |
| Oversells | Orders without stock |
| Payout gaps | Expected vs paid |

## Flow — Map once, publish everywhere, and **let orders and payouts flow back**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Map | Mizan SKU mapped to the marketplace listing (ASIN, Noon SKU, Jumia SKU). | Ops manager |
| 2 | Publish | Title, images, price per channel; category attributes. | Ops manager |
| 3 | ⭐ Sync stock | Available stock minus a per-channel buffer. | Automatic |
| 4 | Ingest orders | Marketplace orders into M1 with channel and fees. | Automatic |
| 5 | Fulfil | Merchant-fulfilled: Mizan ships. Marketplace-fulfilled (FBA, FBN): stock tracked in their warehouse. | Automatic |
| 6 | Reconcile | Marketplace payout split into orders, fees and refunds. | M8 |

- **Channel price rules.** Price per channel = base × markup, or fixed, with floor price.
- **Marketplace warehouses.** FBA / FBN stock is a separate warehouse in M4.
- **Same engine.** Each marketplace is an engine connector with the same resilience and drift detection.

## Main screen — Channels

Filters: `All channels` · `Shopify` · `Amazon` · `Noon` · `Jumia`  
Actions: Map listings, Connect channel

| Channel | Listings | Errors | Orders 30d | Revenue 30d | Fees | Net |
| --- | --- | --- | --- | --- | --- | --- |
| Shopify | 214 | 0 | 3,104 | EGP 3.1M | 2.8% | EGP 610k |
| Noon | 96 | 3 | 622 | EGP 540k | 15.0% | EGP 71k |
| Amazon.eg | 80 | 1 | 410 | EGP 395k | 13.5% | EGP 48k |

_Sample data. Full visual in `design/prototype.html`._

## Rules — Stock allocation

| Rule | Default | Note |
| --- | --- | --- |
| Buffer per channel | 2 units | Avoids oversell on sync lag |
| Priority when low | Own store first | Configurable |
| Sync frequency | On every stock change + every 15 min | — |
| Price floor | Never below cost + channel fee | Blocks publish |
| Out-of-stock behaviour | Pause listing at 0 available | Resumes on restock |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Default buffer | 2 units |
| Price rule | Base price |
| Auto-accept orders | On |
| Auto-pause at zero stock | On |
| Marketplace fulfilment stock | Read-only |

> Commission percentages shown are examples; real fees come from each marketplace's payout reports.

## Events emitted

| Event | Meaning |
| --- | --- |
| `listing.error` | Listing rejected or suppressed |
| `channel.order_received` | Marketplace order ingested |
| `channel.payout_received` | Marketplace payout |
| `listing.paused` | Listing paused (stock or rule) |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `listing.publish` | Publish or update a listing |
| `listing.pause` | Pause on a channel |
| `listing.set_price` | Set a channel price |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Full | Full | Partial |
| Agent | — | — | — |
| Warehouse | Partial | — | — |
| Finance | Full | — | — |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Marketplace cancels an order | Stock released; order cancelled in M1 |
| Listing suppressed | Alert + automation trigger |
| FBA/FBN stock count differs | Marketplace count wins for its warehouse |
| Same order on two channels for the last unit | Buffer prevents most; the later order is flagged to cancel |
| Marketplace changes its API | Engine drift report; fallback paths keep working |

## Acceptance criteria

- [ ] A stock change reaches every connected channel within 15 minutes.
- [ ] Marketplace orders appear in M1 with channel and estimated fees.
- [ ] Profit by channel uses actual fees after payout.
- [ ] Listings with errors are visible with the marketplace's reason.
- [ ] Per-channel buffers and prices apply on every sync.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/channels` | Connected channels |
| GET | `/v1/listings` | Listings and errors |
| POST | `/v1/listings/{id}/publish` | Publish |
| GET | `/v1/channels/{id}/payouts` | Payouts |
| PATCH | `/v1/listings/{id}` | Buffer, price rule, pause |

Conventions: `docs/05-api.md`.

## Entities

`Channel`, `Listing`, `ChannelPriceRule`, `ChannelPayout` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- First marketplace: Noon or Amazon (EG/KSA)?
- Social commerce (TikTok Shop, Instagram) when available in MENA?
- Which marketplace payout reports can be read by API vs file?
