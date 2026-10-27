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
| 2026-10-27 | H-12: `begin; select set_config(…)` as one simple query (node-postgres) | — | — |

H-12 removes one more round-trip: a scoped transaction's opening (role, tenant) travels with BEGIN in one simple query, so a two-query tenant read is 4 round-trips (was 5) and a one-query read 3 (tested in `packages/db/test/postgres.test.ts`). Locally (loopback) this barely moves CPU or throughput; in the cloud it saves one Cloud Run → Cloud SQL round-trip (~0.3–1 ms) on every tenant, platform, staff and worker transaction. PGlite keeps two statements.

Locally the saving is ~0.05 ms; in the cloud it is one network round-trip (~0.3–1 ms) on every tenant, platform and worker transaction.

## Load tests (H-11)

`npm run build && TEST_DATABASE_URL=postgres://… npm run load -w @mizan/perf` — `perf/load/run.ts`.

**What runs.** A fresh database is migrated, then `LOAD_INSTANCES` (default 2, the production minimum) API processes start from the built `apps/api/dist` — production code end to end except the identity provider (fake tokens instead of Firebase). The first instance seeds `LOAD_TENANTS` (2,000) stores, each with an owner and a Shopify connection with an encrypted credential. Each scenario's rate is split across the instances like a load balancer would; the report sums req/s and takes the **worst** percentile of any instance. Request logs are serialized and written exactly as in production (to `/dev/null`). After the run, every acknowledged webhook must exist as a dedupe row and an engine job, so a fast-but-lossy ack fails the gate.

| Scenario | Load | Gate |
| --- | --- | --- |
| warm-up | one webhook per store, builds every tenant engine | — |
| webhook-burst | Shopify `orders/create` (~3 KB, signed) at 500/s for 30 s | p97.5 < 200 ms, ≥ 475/s, 0 errors |
| reads | `GET /v1/members` (token, cached membership, RLS transaction, 2 queries) at 500/s | p97.5 < 300 ms, ≥ 475/s, 0 errors |
| signup | `POST /v1/tenants` (new user, store, owner, warehouse, events, audit) at 50/s | p97.5 < 300 ms, ≥ 47/s, 0 errors |
| health-max / reads-max | unthrottled, 100 connections | capacity, not gated |

autocannon reports p90 and p97.5, not p95; the gates use p97.5, which is stricter than the targets. The nightly workflow (`nightly-load.yml`) runs the same command on a GitHub runner and fails on any missed gate.

### Results — reference setup

One 4-vCPU VM (Xeon 2.1 GHz) running everything: PostgreSQL 16, two API processes and the load generator. Two runs, 30 s per scenario:

| Scenario | req/s | p50 ms | p90 ms | p97.5 ms | p99 ms | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| webhook-burst (500/s) | 497 / 499 | 14 / 13 | 35 / 34 | **55 / 53** | 66 / 65 | 0 |
| reads (500/s) | 500 / 500 | 12 / 12 | 28 / 27 | **39 / 38** | 45 / 45 | 0 |
| signup (50/s) | 50 / 50 | 18 / 18 | 41 / 37 | **71 / 52** | 90 / 68 | 0 |
| health-max | 3,454 / 3,911 | 28 / 24 | 40 / 34 | 50 / 44 | 60 / 53 | 0 |
| reads-max | 797 / 788 | 99 / 101 | 215 / 211 | 245 / 246 | 261 / 264 | 0 |

All webhooks acknowledged were recorded and queued (warm-up + burst ≈ 17,000 per run).

### What the runs taught us

- **The box, not the API, is the ceiling here.** At reads-max both API processes sit at one core each and the VM has no idle CPU left; adding a third instance changed nothing. One API process does ~400 authenticated reads/s or ~450 webhooks/s on this shared VM. Proving 1,000 reads/s needs separate machines: **H-13** (staging on Cloud Run).
- **Per-request CPU** (from `--cpu-prof`): ~0.55 ms is the Nest + Express + helmet + pino floor (`/health`); an authenticated RLS read adds ~1.1 ms, mostly Kysely compilation and five `pg` round-trips (BEGIN, set_config, 2 queries, COMMIT). Follow-ups in **H-12**.
- **Fixed during H-11:** the log formatter scrubbed every log record deeply *before* pino's serializers ran, so it walked the raw `IncomingMessage`/`ServerResponse` on every request line (~6 % of CPU plus its regexes). It now skips `req`/`res`/`err`, which have their own safe serializers (tested). Logs go to stdout through a 4 KiB async buffer flushed every 250 ms instead of one write per line.
- **Generator artifact to avoid:** with `overallRate`, every autocannon connection fires on the same schedule, so 100 connections produce synchronized bursts of 100 requests. That alone pushed webhook p97.5 to ~270 ms at *any* rate. The rate scenarios use 20 connections (`LOAD_CONNECTIONS`), closer to independent arrivals; the gates on req/s still catch a server that cannot keep up.

Knobs: `LOAD_INSTANCES`, `LOAD_TENANTS`, `LOAD_DURATION`, `LOAD_CONNECTIONS`, `LOAD_WEBHOOK_RPS`, `LOAD_READ_RPS`, `LOAD_ONLY=webhook-burst,reads`, `LOAD_OUT=file.json`, `LOAD_NODE_ARGS="--cpu-prof --cpu-prof-dir=…"` (profile the API).
