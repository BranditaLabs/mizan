# ADR-0005: Flutter for the ops app, offline-first

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

Warehouse staff and agents work on phones, often with weak network in warehouses.

## Decision

Flutter app with a local SQLite queue (drift). Every operation has a client-generated `opId`; `POST /v1/ops/sync` applies each exactly once (`stock_movements.device_op_id UNIQUE`).

## Consequences

One codebase for Android and iOS; camera barcode scanning; offline. Second language (Dart) in the team.
