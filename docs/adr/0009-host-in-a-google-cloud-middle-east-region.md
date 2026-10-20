# ADR-0009: Host in a Google Cloud Middle East region

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

Data protection laws (Egypt 151/2020, KSA PDPL), latency from Cairo and the Gulf, and merchant trust.

## Decision

Run production in a Google Cloud Middle East region (Doha `me-central1` or Dammam `me-central2`; confirm service availability for Cloud SQL, Cloud Run, KMS before choosing). Add a KSA deployment when KSA merchants or law require it.

## Consequences

Data stays in the region; Firebase Auth (global) holds only identity data. Confirm with counsel whether Egyptian data may be hosted outside Egypt or needs a licence/registration.
