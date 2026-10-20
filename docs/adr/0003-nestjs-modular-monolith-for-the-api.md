# ADR-0003: NestJS modular monolith for the API

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

Fourteen modules, a team of two backend engineers, and frequent cross-module workflows.

## Decision

One NestJS application with one module per product module (M1–M14) plus platform modules. One image, two entry points (API, worker). Modules communicate through service interfaces and domain events, not shared tables.

## Consequences

Simple deploys and transactions; clear seams to extract a service later (likely candidates: risk network M11, analyst M12). Discipline needed to keep module boundaries; enforce with lint rules on imports.
