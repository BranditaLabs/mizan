# M21 — Developer platform and app integrations · منصة المطورين والتكاملات

> **Phase:** V2 · **Depends on:** All modules, M13 Automations  
> **Estimate:** 2 sprints — API exists from MVP; this adds webhooks out, logs and connectors.

_Public API, webhooks and ready-made links to the tools merchants already use._

## Purpose

The developer platform opens Mizan to merchants' own systems and third-party tools: a public REST API with scoped keys, signed outbound webhooks, an n8n/Zapier/Make connector, Google Sheets sync, and an integration directory. Agencies and developers can build on Mizan without asking the team.

## Users

| User | Uses it to |
| --- | --- |
| Developer | Builds integrations |
| Agency (Brandita) | Connects client tools |
| Owner | Manages keys and apps |

## Success metrics

| Metric | Definition |
| --- | --- |
| Active API keys | Keys used in last 30 days |
| Webhook success rate | Delivered ÷ sent |
| Integrations installed | Per tenant |
| Time to first API call | Key created to first successful request |

## Flow — Keys, webhooks and connectors, **with every call logged**.

| # | Step | What happens | Who |
| --- | --- | --- | --- |
| 1 | Create key | Scoped API key (read orders, write products …). | Owner |
| 2 | ⭐ Subscribe | Webhooks for any Mizan event, signed and retried. | Developer |
| 3 | No-code | n8n, Zapier, Make and Google Sheets connectors. | Ops / agency |
| 4 | Monitor | Request log, webhook delivery log, replay. | Developer |

- **Same API as the app.** The web and ops apps use the public API; nothing is private-only without reason.
- **Signed webhooks.** X-Mizan-Signature with timestamp; 24 h retries.
- **Rate limits.** Per key, published in headers.

## Main screen — Developers

Filters: `API keys` · `Webhooks` · `Logs` · `Integrations`  
Actions: Docs, New API key

| Name | Type | Scopes / events | Last used | Status |
| --- | --- | --- | --- | --- |
| ERP sync | API key | orders:read, products:write | 2 min ago | Active |
| n8n | Webhook | order.confirmed, shipment.delivered | 1 h ago | 99.8% delivered |

_Sample data. Full visual in `design/prototype.html`._

## Rules — Scopes

| Scope | Allows | Note |
| --- | --- | --- |
| orders:read / write | Read or change orders | — |
| products:write | Catalog, prices, stock | Field ownership applies |
| payments:read | Ledger, payouts | No refunds |
| refunds:write | Create refunds | Owner only |
| webhooks:manage | Create and delete subscriptions | Owner, admin |

### Settings (defaults)

| Setting | Default |
| --- | --- |
| Webhook retries | 24 h with backoff |
| Key expiry | None (rotate yearly) |
| Rate limit | Per key, in headers |
| API version | /v1 |
| Sandbox tenant | On request |

> Keys never grant access to card data (Mizan has none) or to other tenants.

## Events emitted

| Event | Meaning |
| --- | --- |
| `webhook.failed` | Endpoint failing |
| `api_key.created` | Key created |
| `api_key.revoked` | Key revoked |
| `webhook.disabled` | Endpoint disabled after repeated failures |

## Actions exposed (for Automation Studio)

| Action | Does |
| --- | --- |
| `webhook.call` | Call any URL from an automation |
| `webhook.replay` | Replay a failed delivery |
| `sheet.append_row` | Append a row to Google Sheets |

## Permissions

| Role | View | Act | Configure |
| --- | --- | --- | --- |
| Owner | Full | Full | Full |
| Ops manager | Partial | — | — |
| Agent | — | — | — |
| Warehouse | — | — | — |
| Finance | Partial | — | — |

## Edge cases

| Situation | Behaviour |
| --- | --- |
| Endpoint down | Retries, then disabled with alert |
| Key leaked | Revoke instantly; audit log shows use |
| Event volume spike | Deliveries queued per subscription; order kept |
| Breaking API change needed | New /v2 with 6 months overlap |

## Acceptance criteria

- [ ] OpenAPI 3.1 published; every endpoint documented.
- [ ] Webhook signature verifiable with published examples.
- [ ] Every webhook delivery is logged and can be replayed.
- [ ] Keys can be scoped, rotated and revoked in one click.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET / POST | `/v1/api-keys` | Keys |
| GET / POST | `/v1/webhook-subscriptions` | Webhooks |
| GET | `/v1/webhook-deliveries` | Delivery log |
| POST | `/v1/webhook-deliveries/{id}/replay` | Replay |
| DELETE | `/v1/api-keys/{id}` | Revoke a key |

Conventions: `docs/05-api.md`.

## Entities

`ApiKey`, `WebhookSubscription`, `WebhookDelivery`, `Integration` — tables in `packages/db/migrations/`, mapping in `docs/04-data-model.md`.

## Open questions

- Public app marketplace for third parties (V3)?
- Official n8n and Zapier apps, or generic webhooks first?
- Partner programme for agencies building on Mizan?
