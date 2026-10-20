# Mizan · ميزان

**The complete commerce operating system for MENA brands — every channel, every payment method, real profit on every order.** Powered by Brandita.

Mizan runs the whole operation in one product: orders from stores, marketplaces and shops; payments by COD, card, wallet, deposit, BNPL or bank transfer; verification, shipping, warehouse, purchasing, returns, customer service, reconciliation, finance and reports — all connected by Automation Studio, with a profit engine that counts every fee, refund and returned parcel against the order that caused it.

## Status

| Part | State |
| --- | --- |
| `packages/engine` — self-healing Shopify + Bosta connectors, every payment method | ✅ Built · 85 tests incl. chaos at 50% failure with mixed payments |
| `packages/db` — PostgreSQL schema with row-level security, migration runner, typed Kysely access | ✅ Built · 22 tests (PGlite + real PostgreSQL) |
| `docs/` — business model, product (22 modules), payments, automations, architecture, data, API, integrations, security, design, infra, backlog | ✅ Written |
| `design/prototype.html` — UI direction (AR/EN, light/dark) | ✅ Approved |
| `packages/shared` — canonical types, zod schemas, exact money, EG/KSA/UAE phones | ✅ Built · 122 tests, 100% coverage |
| `apps/api` — NestJS API: config, redacting logger, problem+json, OpenAPI, tenant-scoped DB, Firebase auth + roles | 🚧 Foundations · 67 tests |
| `apps/web`, `apps/ops` | ⏳ Next — see `docs/10-backlog.md` |

## Start

```
npm install
npm test          # engine + db
npm run demo      # engine against misbehaving fake Shopify and Bosta
```

Node 22+.

## Read first

- `CLAUDE.md` — rules and map for anyone (or any agent) building here
- `docs/01-business-model.md` — the business
- `docs/10-backlog.md` — what to build next

© 2026 Brandita. All rights reserved. Confidential.
