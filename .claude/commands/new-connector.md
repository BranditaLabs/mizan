---
description: Build a new storefront, marketplace, courier, gateway or messaging connector in packages/engine, with a fake server and chaos tests
argument-hint: <provider name> (e.g. easyorders, jt-express)
---

Build a connector for **$ARGUMENTS** in `packages/engine/src/connectors/$ARGUMENTS/`.

Before writing code:
1. Read `docs/06-integrations.md` (access, quirks) and the existing `shopify/` and `bosta/` connectors as the pattern.
2. Collect the provider's official API docs (ask me for links or sample payloads if you cannot reach them). List every endpoint you will use and every fact you could not confirm.

Then, in this order:
1. `client` — every call through `send()` (`src/resilience/http.ts`) with its own `CircuitBreaker` and `AdaptiveBucket`; classify body-level errors in `inspect` into the `ErrorKind` taxonomy.
2. `mapper` — provider ↔ canonical model via `Resolver` candidate paths only. Required fields use `{ required: true }`. Never read a payload field directly.
3. Couriers: a label table for `StatusMapper`; **leave numeric codes empty** unless confirmed by the provider's docs. The COD amount always comes from `cashToCollect(order)`, never from the order total.
   Storefronts and marketplaces: fill `paymentMode`, `paymentStatus`, `gateways`, `received`, `outstanding`, `refunded` on the canonical order; add detection tests for every payment method the platform supports.
   Gateways and BNPL: map transactions to ledger lines (`sale`, `capture`, `refund`, `chargeback`) keyed by the provider's transaction id; read payout reports for M8.
4. Writes safe to repeat: provider idempotency key if it exists, otherwise look up before create (see `bosta/connector.ts` `createShipmentOnce`).
5. Webhooks: verify signature (or per-connection token if unsigned); thin webhook, fat fetch.
6. `test/fakes/$ARGUMENTS.ts` — fake server reproducing real quirks: throttling, 5xx, hangs, dropped responses, duplicated/out-of-order webhooks, at least one alternative payload shape.
7. Tests: unit tests for mapping and status; add the connector to an e2e chaos test at 10%, 25%, 50% failure. Required result: no duplicates, nothing lost, empty dead-letter queue.
8. Register job kinds in `src/engine/engine.ts`.
9. Update `docs/06-integrations.md` §2 (engine status) and `docs/10-backlog.md`.

Run `npm test -w @mizan/engine` and `npm run typecheck` before finishing. Report any unconfirmed provider facts at the end.
