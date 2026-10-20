# ADR-0007: Label-first courier status mapping with learned codes

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

Bosta's public SDKs disagree on numeric state codes; other couriers will have the same problem.

## Decision

Map statuses from labels first. Learn code→status pairs when both arrive together. Trust a learned terminal status from a code only after 3 consistent confirmations or an ops override. Unknown → `unknown` + review, never a guess. Ordering guard never leaves a terminal status.

## Consequences

No wrong 'delivered' (which would mark COD orders paid). Some statuses wait for review until learned.
