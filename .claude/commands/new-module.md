---
description: Implement (part of) a product module in apps/api and apps/web from its spec
argument-hint: <module id and story>, e.g. "M1 E5-1"
---

Implement **$ARGUMENTS**.

1. Read `CLAUDE.md`, the module spec in `docs/modules/`, the story in `docs/10-backlog.md`, and the related sections of `docs/04-data-model.md` and `docs/05-api.md`.
2. Write a short plan (files to add or change, migrations, endpoints, events) and check it against the non-negotiable rules in `CLAUDE.md`.
3. Schema changes: a new forward-only migration in `packages/db/migrations/` with RLS for new tables; extend `packages/db/test`.
4. API: NestJS module under `apps/api/src/modules/<name>/`; zod DTOs from `packages/shared`; role guards; problem+json errors with stable `code`s; emit domain events in the same transaction as the change.
5. Web: screens per `docs/08-design-system.md` and `design/prototype.html`; strings in `messages/ar.json` and `messages/en.json`; logical CSS only; `<bdi>` for numbers and IDs in Arabic.
6. Tests: unit + integration (tenant isolation for every new query path); acceptance criteria from the module spec as test names where possible.
7. Update the module spec if behaviour differs, and tick the story in `docs/10-backlog.md`.

Finish with `npm test` and `npm run typecheck`, and a summary of what is left.
