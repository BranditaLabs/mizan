# Mizan · ميزان

**The operating system that shows every COD store its real profit, on every order.** Powered by Brandita.

Mizan runs the work between checkout and cash for MENA e-commerce brands: order sync, risk-scored confirmation in every dialect, shipping, warehouse, returns, cash reconciliation, and a profit engine that charges every refused parcel to the order that caused it.

## Status

| Part | State |
| --- | --- |
| `packages/engine` — self-healing Shopify + Bosta connectors | ✅ Built · 57 tests incl. chaos at 50% failure |
| `packages/db` — PostgreSQL schema with row-level security | ✅ Built · 5 tests |
| `design/prototype.html` — UI direction (AR/EN, light/dark) | ✅ Approved |
| `apps/api`, `apps/web`, `apps/ops`, `packages/shared` | ⏳ Next — see `docs/10-backlog.md` |

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
