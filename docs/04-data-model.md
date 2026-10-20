# 04 — Data model

The source of truth is the SQL in **`packages/db/migrations/`** (`0001_core.sql`, `0002_commerce_os.sql`, `0003_app_role.sql`). This page explains it. Tests in `packages/db/test/schema.test.ts` prove that migrations apply, RLS isolates tenants (and is enabled on **every** tenant table), generated columns compute correctly, and gateway transactions cannot be double-counted.

## 1. Conventions

| Rule | Detail |
| --- | --- |
| IDs | `UUID` with `gen_random_uuid()` (built into PostgreSQL 13+) |
| Tenancy | Every business table has `tenant_id UUID NOT NULL` and the `tenant_isolation` RLS policy (FORCE enabled) |
| Money | `BIGINT` minor units + `CHAR(3)` currency. `*_minor` suffix. EGP and SAR have 2 decimals; KWD, BHD, OMR, JOD, IQD have 3 — use a currency table, never assume 100 |
| Time | `TIMESTAMPTZ`, stored UTC; display in `tenants.timezone` |
| External IDs | `TEXT`, unique per `connection_id` |
| Status fields | `TEXT` + `CHECK` constraint (easy to extend in a migration; no Postgres enums) |
| Personal data | `customers.phone_e164`, names, addresses: encrypted at application level in production (see `docs/07-security-compliance.md`); `phone_hash` for lookups |
| Soft delete | Only where the business needs history (`tenants.status = 'deleted'`); otherwise real deletes for privacy requests |
| Migrations | Forward-only, numbered `NNNN_name.sql`; never edit an applied migration |

### Access from code (ADR-0012)

| Piece | Where | Rule |
| --- | --- | --- |
| Query builder | Kysely, typed by `packages/db/src/schema.ts` | Generated: run `npm run codegen -w @mizan/db` after every migration (a test fails if stale) |
| Tenant scope | `withTenant(db, tenantId, fn)` / `Database.tenant()` in the API | Transaction with `SET LOCAL ROLE mizan_app` + `set_config('app.tenant_id', …, true)`; RLS filters every query |
| Platform scope | `withoutTenant` / `Database.platform()` | App role, no tenant: tenant tables return nothing; for tenants/users lookups. With `setActingUser(trx, userId, { email?, phone? })` the `member_self_read` policy (0004) shows that user's own memberships, and `invitee_read` (0005) their pending invitations by verified email / phone (read-only) |
| Owner access | `Database.kysely` | Migrations and signup bootstrap only |
| Migrations | `mizan-db migrate` (`DATABASE_URL_MIGRATOR`) | One transaction per file, checksums, advisory lock; PGlite dev/test databases migrate at boot |
| BIGINT | Parsed to JS `bigint` (pg and PGlite) | Never `number`: KWD amounts in fils pass 2^53 sooner than you think |

Canonical (engine) money is a decimal **string** (`"1150.00"`). Convert at the boundary: `toMinor("1150.00", "EGP") = 115000`. The helpers live in `packages/shared/src/money.ts` (`toMinor`, `fromMinor`, `currencyDecimals`, `addMoney` …), tested for 0, 2, 3 and 4 decimal currencies. They never round: an amount with more decimals than its currency allows is rejected.

## 2. Entity map

```mermaid
erDiagram
  tenants ||--o{ memberships : has
  users ||--o{ memberships : has
  tenants ||--o{ connections : has
  connections ||--o| secrets : "secret_ref"
  tenants ||--o{ products : has
  products ||--o{ variants : has
  variants ||--o{ external_variants : "mapped in stores"
  warehouses ||--o{ stock_levels : holds
  variants ||--o{ stock_levels : counted
  stock_levels ||--o{ stock_movements : "changed by"
  customers ||--o{ orders : places
  orders ||--o{ order_lines : contains
  orders ||--o{ order_events : history
  orders ||--o{ confirmations : "confirmed by"
  orders ||--o{ shipments : "shipped as"
  shipments ||--o{ shipment_events : tracks
  orders ||--o{ tickets : "support / returns"
  orders ||--|| order_pnl : "profit"
  settlements ||--o{ settlement_lines : contains
  settlement_lines }o--|| shipments : matches
  connections ||--o{ ad_spend : imports
  automations ||--o{ automation_runs : runs
  orders ||--o{ payments : "ledger"
  orders ||--o{ refunds : refunds
  orders ||--o{ disputes : chargebacks
  payments ||--o{ settlement_lines : "paid out in"
  suppliers ||--o{ purchase_orders : supplies
  purchase_orders ||--o{ purchase_order_lines : contains
  customers ||--o{ conversations : "talks in"
  conversations ||--o{ messages : contains
  variants ||--o{ listings : "listed on channels"
  customers ||--o{ store_credit_ledger : credit
```

## 3. Tables by module

| Module | Tables |
| --- | --- |
| Platform | `tenants`, `users`, `memberships`, `api_keys`, `connections`, `secrets`, `domain_events`, `audit_log`, `privacy_requests` |
| Engine | `mz_inbound_events`, `mz_outbox`, `mz_records` (same as `packages/engine/src/sync/sql-store.ts`, plus `tenant_id`) |
| M1 Orders | `orders` (incl. `channel`, `payment_mode`, `payment_status`, `paid_minor`, `refunded_minor`, `balance_minor`), `order_lines`, `order_events`, `customers`, `external_variants` |
| M2 Confirmation | `confirmations`, `orders.risk_score`, `orders.confirm_route` |
| M3 Shipping | `shipments`, `shipment_events` |
| M4 Warehouse | `products`, `variants`, `warehouses`, `stock_levels`, `stock_movements` |
| M5 Profit | `order_pnl`, `cost_rules`, `fx_rates` |
| M6 Returns | `tickets` |
| M7 Attribution | `ad_spend`, `orders.utm`, `orders.click_ids` |
| M8 Reconciliation | `settlements` (`source_type`: courier, gateway, bnpl, bank, marketplace), `settlement_lines` (`line_kind`, `payment_id`) |
| M13 / M14 | `automations`, `automation_runs`, `scripts` |
| M15 Payments | `payments` (signed ledger), `payment_links`, `refunds`, `disputes`, `store_credit_ledger` |
| M16 Purchasing | `suppliers`, `purchase_orders`, `purchase_order_lines`, `landed_costs` |
| M17 Inbox | `conversations`, `messages` |
| M18 Channels | `listings`; marketplace accounts are `connections` with `kind = 'marketplace'`; marketplace warehouses are `warehouses.type = 'marketplace_fc'` |
| M19 Finance | `expenses`, `accounting_periods`, `tax_documents` |
| M20 / M21 / M22 | `reports`; `webhook_subscriptions`, `webhook_deliveries`; `pos_shifts` (shops are `warehouses.type = 'shop'`, sales are orders with `channel = 'pos'`) |
| Later migrations | M9 segments, campaigns and loyalty tiers; M10 commission rules and payouts; M11 risk network (separate schema, hashed); M12 routing rules; billing |

## 4. Key rules encoded in the schema

- **One order per store order:** `UNIQUE (tenant_id, connection_id, external_id)` on `orders`. Webhooks received twice cannot create two orders.
- **One shipment per tracking number per courier account:** `UNIQUE (connection_id, tracking_number)`.
- **Exactly-once offline scans:** `stock_movements UNIQUE (tenant_id, device_op_id)`. The ops app generates `device_op_id` per scan; replays are ignored.
- **Available stock is derived:** `stock_levels.available = on_hand − reserved` (generated column). Never write it.
- **Net profit is derived:** `order_pnl.net_minor` is a generated column. The profit service writes components only.
- **One automation run per event:** `automation_runs UNIQUE (automation_id, event_id)`.
- **Outbox idempotency:** `mz_outbox.idempotency_key UNIQUE`.
- **One ledger line per gateway transaction:** `payments UNIQUE (connection_id, external_ref, kind)`.
- **Balance is derived:** `orders.balance_minor = max(total − paid, 0)`, what the customer still owes (COD due, deposit balance).

## 5. Profit computation (M5)

`order_pnl` is recomputed by the profit service on every event that touches the order (`order.confirmed`, `shipment.*`, `return.inspected`, `settlement.matched`, ad spend import). Rules:

| Component | Source | When |
| --- | --- | --- |
| `revenue_minor` | Order total (base currency, FX of `placed_at` day) | COD: on delivery. Card/wallet/BNPL: on capture. Bank transfer: on match. Marketplace: on marketplace confirmation. POS: on sale. Refused: 0 |
| `refund_minor` | Σ completed refunds | On `refund.completed` |
| `cogs_minor` | Σ `order_lines.unit_cost_minor × quantity` | On confirm; reversed if restocked after return |
| `shipping_minor` | Settlement fee, else courier rate card (`cost_rules`) | On ship; corrected on settlement |
| `cod_fee_minor` | Settlement, else `cod_fee_pct` | On delivered (COD and deposit balance) |
| `payment_fee_minor` | Gateway or BNPL fee: estimate at capture, actual from payout | Card, wallet, BNPL, deposit |
| `channel_fee_minor` | Marketplace commission and fulfilment fees | Marketplace orders |
| `ads_minor` | Attributed spend (M7); MVP: daily spend ÷ delivered orders that day, per store | Daily job |
| `agent_minor` | `agent_per_order` rule or M10 commission | On confirm |
| `packaging_minor` | `packaging_per_order` rule | On pack |
| `rto_minor` | Return leg fee + write-off value for damaged items | On returned / inspected |
| `chargeback_minor` | Disputed amount + dispute fee | On `dispute.opened`; reversed if won |

`is_final = true` once delivered and settled, or returned and inspected. Dashboards show provisional and final profit separately.

## 6. Indexes to add with real data

Measure first with `EXPLAIN ANALYZE` on pilot data. Likely candidates: `orders (tenant_id, phone_hash, placed_at)` for duplicate checks; `shipments (tenant_id, tracking_number)`; `order_pnl (tenant_id, is_final)`; trigram index on `orders.number` for search.
