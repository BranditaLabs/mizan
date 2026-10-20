# ADR-0004: Next.js App Router + Tailwind for the web app

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

Premium bilingual dashboard, RTL, server rendering for fast first load, team familiarity.

## Decision

Next.js (App Router), Tailwind CSS with design tokens as CSS variables, next-intl for AR/EN, owned UI components (shadcn/ui style).

## Consequences

Strong ecosystem; RTL handled with logical utilities and a lint rule. Keep business logic in the API, not in Next.js server actions.
