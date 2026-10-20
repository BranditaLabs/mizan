# apps/ops — Mizan ops app (planned)

Flutter app for warehouse staff and confirmation agents. Offline-first: local queue with `opId` per operation, synced through `POST /v1/ops/sync` (exactly once).

- Design: `docs/08-design-system.md` §7
- Decision: `docs/adr/0005-flutter-for-the-ops-app-offline-first.md`
- Start with backlog story **E8-4** (prototype offline sync first).
