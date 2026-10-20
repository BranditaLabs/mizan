# Performance results

Benchmarks and load tests live in `perf/` (workspace `@mizan/perf`). Record every run that changes a number here, with the setup, so regressions are visible.

## Reference setup (local)

PostgreSQL 16.15 on the same host (TCP localhost), Node 22, pool of 10. Cloud numbers differ: Cloud Run → Cloud SQL adds ~0.3–1 ms per round-trip, which is why round-trips matter more than raw query time.

## Tenant transaction (H-1)

`TEST_DATABASE_URL=… npm run bench:tenant-tx -w @mizan/perf` — `withTenant` + one indexed read.

| Date | Change | Sequential ms/tx | Parallel tx/s (pool 10) |
| --- | --- | --- | --- |
| 2026-10-20 | Before: `SET LOCAL ROLE` + `set_config` (2 setup statements) | 0.63–0.75 | 3,560–4,532 |
| 2026-10-20 | H-1: role + tenant in one `set_config` statement | 0.59–0.67 | 4,171–4,903 |

Locally the saving is ~0.05 ms; in the cloud it is one network round-trip (~0.3–1 ms) on every tenant, platform and worker transaction.
