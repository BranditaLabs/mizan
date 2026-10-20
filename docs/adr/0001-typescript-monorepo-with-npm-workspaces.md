# ADR-0001: TypeScript monorepo with npm workspaces

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

We need one language across engine, API and web so types (canonical model, API DTOs) are shared and a small team can move across layers.

## Decision

Use a single repository with npm workspaces: `packages/*` (engine, db, shared) and `apps/*` (api, web, ops). TypeScript strict mode everywhere except the Flutter app (Dart).

## Consequences

Shared types without publishing packages; one CI pipeline. Flutter app sits outside the TS toolchain but in the same repo. If builds slow down, add Turborepo or Nx later without changing layout.
