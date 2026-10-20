# ADR-0008: Field ownership for product sync

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

Prices and stock are edited both in Mizan and in Shopify admin; naive two-way sync causes loops and overwrites.

## Decision

Each synced field has an owner per connection (default: Mizan owns price, compare-at price, inventory). On an incoming change, the owner's value wins; Mizan's own echoes are ignored by value comparison.

## Consequences

No ping-pong. Merchants who prefer Shopify as master can flip ownership per field.
