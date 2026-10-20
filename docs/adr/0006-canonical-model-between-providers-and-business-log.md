# ADR-0006: Canonical model between providers and business logic

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

Mizan connects to many storefronts and couriers whose payloads differ and change.

## Decision

Connectors map provider payloads to canonical types (`CanonicalOrder`, `CanonicalProduct`, `CanonicalShipment`, `ShipmentStatus`) using `Resolver` candidate paths. Business code never sees provider payloads (raw kept only for debugging).

## Consequences

Adding a provider does not touch modules. Provider changes become drift events, not outages.
