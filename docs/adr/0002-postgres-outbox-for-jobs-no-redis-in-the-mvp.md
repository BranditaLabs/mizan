# ADR-0002: Postgres outbox for jobs, no Redis in the MVP

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

Every external write must survive crashes and retries, and be idempotent. Options: Redis + BullMQ, a managed queue (Pub/Sub, Cloud Tasks), or a Postgres outbox.

## Decision

Use the Postgres outbox already built in `packages/engine/src/sync` (`FOR UPDATE SKIP LOCKED`, leases, idempotency keys, dead letters). Domain events use the same pattern. No Redis in the MVP.

## Consequences

State change and job creation commit in one transaction (no lost jobs). One fewer system to run. Throughput is enough for MVP scale (thousands of jobs/minute). Revisit if outbox polling load becomes significant: move dispatch to Pub/Sub while keeping the outbox as the source of truth. (Supersedes the Redis/BullMQ line in the v1.0 product spec.)
