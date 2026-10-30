# apps/ops — Mizan ops app (Flutter)

The phone app for warehouse staff and agents: **offline-first**. Every operation is saved on the phone first (drift / SQLite) with its own `opId`, then synced through `POST /v1/ops/sync`, which applies each `opId` exactly once (ADR-0005). Arabic first (right to left), English too; the Brandita theme from `packages/design-system`.

## What is built (E8-4 part 1: offline sync first)

- `lib/sync/` — the queue (`OpStore`), the sync client (`HttpSyncApi`: token, store, error kinds) and the engine (`SyncEngine`): batches of up to 200, oldest first; applied / rejected / conflict recorded with why; no answer (offline, a lost response, 5xx) keeps the ops pending and the **same opIds** go again, so nothing is applied twice or lost; one run at a time; backoff with jitter and `Retry-After`.
- `lib/app/` — the first screen: count an item (barcode or SKU, quantity), saved at once with or without a connection; the phone's operations and what Mizan decided.
- Tests: a fake sync server with Mizan's exactly-once rule that drops, refuses and loses answers; a chaos run of 300 operations at 10/25/50 % failures (each applied once, in order, nothing left pending); the HTTP client's wire format and error kinds; the screen in Arabic and English.

Next: sign-in (Firebase, the store), camera scanning, pick lists and scan-to-pack (backlog E8-4b, E8-4c).

## Commands

```
cd apps/ops
flutter pub get
dart run build_runner build --delete-conflicting-outputs   # after changing lib/sync/op_store.dart (drift)
flutter gen-l10n                                           # after changing lib/l10n/*.arb
flutter analyze
flutter test
```

Flutter 3.47.9 (pinned in CI). The theme (`lib/theme/mizan_tokens.dart`) and fonts (`assets/fonts`) are copies of `packages/design-system`; a test fails when they drift.
