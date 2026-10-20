# 09 — Infrastructure, environments and operations

## 1. Environments

| Env | Purpose | Data | Providers |
| --- | --- | --- | --- |
| `local` | Development | Docker Postgres or PGlite; fakes for all providers | Fakes (`packages/engine/test/fakes`) |
| `staging` | Integration testing, demos | Synthetic + test stores | Shopify dev store, Bosta staging, Meta test numbers, Paymob test keys |
| `production` | Merchants | Real | Live credentials |

Each env is a separate Google Cloud project (`mizan-staging`, `mizan-prod`) in the Middle East region.

## 2. Google Cloud layout (production)

| Component | Service | Notes |
| --- | --- | --- |
| API | Cloud Run (`api`) | Min 2 instances, concurrency 80, behind HTTPS load balancer + Cloud Armor |
| Worker | Cloud Run (`worker`), CPU always allocated | Min 1; scale on outbox backlog metric |
| Web | Cloud Run (`web`) | Next.js standalone output |
| Database | Cloud SQL PostgreSQL 16+, HA | PITR on; private IP; connection via Cloud SQL connector |
| Secrets | Secret Manager (app secrets) + Cloud KMS (tenant data keys) | — |
| Files | Cloud Storage (labels, exports, settlement uploads) | Signed URLs, lifecycle rules |
| Scheduler | Cloud Scheduler → worker `/internal/cron/*` | Reconcile polls (5 min), FX (daily), ad spend (hourly, V2) |
| Logs, metrics, traces | Cloud Logging, Monitoring, Trace (OpenTelemetry) | PII redaction in logger |
| Errors | Sentry (or Error Reporting) | Scrub PII |
| CDN | Cloud CDN for web static assets | — |

Infrastructure as code: Terraform in `infra/` (create in backlog E1).

## 3. Configuration

All config through environment variables, validated at startup with zod (`apps/api/src/platform/config.ts`, ✅ built in E1-3). An invalid environment exits with code 1 and one line per bad variable (names and reasons, never values). `apps/api/.env.example` lists what the API reads today; the root `.env.example` is for the standalone engine only. Groups (target):

```
DATABASE_URL (postgres:// · unset or pglite:<dir> in dev/test), DATABASE_URL_MIGRATOR, DATABASE_POOL_MAX
FIREBASE_PROJECT_ID, GOOGLE_APPLICATION_CREDENTIALS (local only)
KMS_KEY_NAME (required in production; SECRETS_DEV_KEY = base64 32 bytes for local dev only)
PUBLIC_URL, WEB_URL
SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_API_VERSION=2026-10, SHOPIFY_SCOPES
PAYMOB_* (platform-level config only; merchant keys live in the secrets table)
BOSTA_BASE_URL, BOSTA_TRACKING_URL_TEMPLATE, WORKER_IN_PROCESS (dev only)
META_APP_ID, META_APP_SECRET, WHATSAPP_VERIFY_TOKEN
SENTRY_DSN, LOG_LEVEL
```

Per-merchant credentials (Bosta key, Shopify token) live in the `secrets` table, never in env.

**Database roles:** migrations run as the schema owner (`DATABASE_URL_MIGRATOR`, `mizan-db migrate`). The API and worker log in as a separate user that is a member of `mizan_app` (tenant data under RLS) and `mizan_worker` (event dispatch across tenants on `domain_events` only), and is neither owner nor `BYPASSRLS`: `CREATE ROLE mizan_api LOGIN … IN ROLE mizan_app, mizan_worker` (Terraform, E1-11).

## 4. CI/CD (GitHub Actions)

| Workflow | Trigger | Steps |
| --- | --- | --- |
| `ci.yml` ✅ | PR, push to `main` | job `build-test`: `npm ci` → typecheck → tests for all workspaces (engine incl. chaos suite, db schema + RLS). Job `secrets-scan`: gitleaks over full history. Lint and build steps are added as apps land. |
| `deploy-staging.yml` | Merge to `main` | build images → push to Artifact Registry → run migrations (migrator role) → deploy Cloud Run → smoke test |
| `deploy-prod.yml` | Git tag `v*` (manual approval) | same as staging, against prod; migrations must be backward compatible with the previous release |
| `ops-app.yml` | Tag `ops-v*` | Flutter build → Play internal track / TestFlight |

Branching: trunk-based, short-lived feature branches, PR review required, squash merge. Conventional commits.

**Branch protection for `main`** (set by a repo admin in GitHub → Settings → Branches, or as a ruleset):

- Require a pull request before merging, 1 approval, dismiss stale approvals on new commits.
- Required status checks: `Typecheck and test`, `Secret scan (gitleaks)`; require branches to be up to date.
- Allow squash merge only; block force pushes and deletion.

**Dependency updates:** Renovate (`renovate.json`) — weekly (Monday before 09:00 Cairo), pins exact versions, groups non-major dev deps and GitHub Actions, pins action digests, tracks the gitleaks version in `ci.yml`. Requires the Renovate GitHub App installed on the repo.

**Secret scanning:** gitleaks with default rules (`.gitleaks.toml`); only `packages/*/test/fakes/` is allowlisted (dummy provider credentials). A finding fails CI — rotate the secret first, then rewrite or allowlist.

## 5. Observability

**Golden signals per service:** request rate, error rate, p95 latency, saturation.

**Business health metrics (alert on these):**

| Metric | Alert when |
| --- | --- |
| Outbox pending age (oldest pending job) | > 10 min |
| Dead letters per tenant | > 0 new in 1 h (notify tenant ops) / > 20 (page) |
| Circuit open per provider | Open > 5 min |
| Drift events per connector | New `missing_field` or `shape_changed` kind |
| Webhook ack p95 | > 1 s |
| Order sync lag (store placed → Mizan created) | p95 > 2 min |
| Shipment status freshness | Active shipments not updated in 24 h |
| Orders awaiting payment | Bank-transfer or unpaid prepaid orders older than the tenant's deadline |
| Payment webhooks | Gateway webhook failures or signature rejections > 0 in 15 min |
| Refunds pending | Refund sent but not confirmed after 72 h |
| Payout gaps | Expected vs paid difference above threshold per source |
| Automation errors | Error rate > 20% for any automation (auto-paused) |

`engine.health()` feeds `/v1/admin/integrations/health` and a Monitoring dashboard.

### Prometheus metrics (✅ H-9)

Each API instance serves `GET /metrics` (Prometheus text format, outside `/v1`); the worker listens on `PORT` for `GET /health` and `GET /metrics` only (engine jobs, and so provider circuits, live there). It is internal: it answers 404 unless `METRICS_TOKEN` is set, then requires `Authorization: Bearer <METRICS_TOKEN>` (compared in constant time). Cloud Run sends it to Managed Service for Prometheus via the sidecar collector. Labels never carry tenant ids, user ids, phones or raw paths: HTTP routes are labelled by template (`/v1/members/:userId`), requests that match no route are `unmatched`, `status` is the class (`2xx`…`5xx`, exact code only on `mizan_webhooks_total`), and webhook providers outside the known set are `other`.

| Metric | Type | Labels |
| --- | --- | --- |
| `mizan_http_request_duration_seconds` | histogram | `method`, `route`, `status` |
| `mizan_webhooks_total` | counter | `provider`, `status` |
| `mizan_rate_limited_total` | counter | `policy` (`ip`, `user`) |
| `mizan_idempotent_replays_total` | counter | — |
| `mizan_outbox_jobs` | gauge (at scrape) | `status` (`pending`, `running`, `dead`) |
| `mizan_outbox_oldest_due_seconds` | gauge (at scrape) | — |
| `mizan_domain_events` | gauge (at scrape) | `state` (`pending`, `dead`, `oldest_pending_seconds`) |
| `mizan_db_pool_connections` | gauge (at scrape) | `state` (`total`, `idle`, `waiting`) |
| `mizan_engine_circuits_open` | gauge (at scrape) | `provider` |
| `mizan_process_*`, `mizan_nodejs_*` | default | — |

Alert rules (PromQL, in Cloud Monitoring):

| Alert | Expression | For | Severity |
| --- | --- | --- | --- |
| API p95 latency | `histogram_quantile(0.95, sum by (le) (rate(mizan_http_request_duration_seconds_bucket{route!~"/webhooks.*"}[5m]))) > 0.3` | 10 m | page |
| Webhook ack p95 | `histogram_quantile(0.95, sum by (le) (rate(mizan_http_request_duration_seconds_bucket{route=~"/webhooks.*"}[5m]))) > 0.2` | 10 m | page |
| 5xx rate | `sum(rate(mizan_http_request_duration_seconds_count{status="5xx"}[5m])) / sum(rate(mizan_http_request_duration_seconds_count[5m])) > 0.01` | 5 m | page |
| Webhook rejections | `sum by (provider) (increase(mizan_webhooks_total{status="401"}[15m])) > 0` | — | ticket |
| Outbox lag | `max(mizan_outbox_oldest_due_seconds) > 600` | 5 m | page |
| Dead letters | `max(mizan_outbox_jobs{status="dead"}) - max(mizan_outbox_jobs{status="dead"} offset 1h) > 20` | — | page |
| Event dispatch lag | `max(mizan_domain_events{state="oldest_pending_seconds"}) > 120` or `max(mizan_domain_events{state="dead"}) > 0` | 10 m | ticket |
| DB pool saturated | `max(mizan_db_pool_connections{state="waiting"}) > 0` | 5 m | ticket |
| Circuit open | `max by (provider) (mizan_engine_circuits_open) > 0` | 5 m | ticket |
| Rate limiting spike | `sum(rate(mizan_rate_limited_total{policy="ip"}[5m])) > 10` | 10 m | ticket (possible abuse) |

Queue gauges are global counts read at scrape time (one cheap query each, under the worker role), so every instance reports the same value: aggregate them with `max`, not `sum`.

## 5a. Table hygiene (✅ H-7)

The worker prunes high-churn tables every 10 minutes in batches (5,000 rows × up to 20 batches per table per run): finished engine jobs after `RETENTION_JOBS_DAYS` (7), webhook dedupe keys after `RETENTION_WEBHOOK_KEYS_DAYS` (14; providers retry for ≤ 48 h), dispatched domain events after `RETENTION_EVENTS_DAYS` (30), expired idempotency keys. Pending, running and dead work is never pruned. At 10× scale (10M orders/month ≈ 50M engine jobs/month) the outbox holds about a week of done jobs (~12M rows), indexed for the due queries only.

## 5b. Database connection budget (✅ H-8)

Every process opens at most `DATABASE_POOL_MAX` connections (default 10). Keep

    (API max instances × API pool) + (worker max instances × worker pool) + 20 (migrations, admin, monitoring) ≤ Cloud SQL max_connections

Reference for the 10× target: Cloud SQL `db-custom-8-32768` (max_connections ≈ 800 by default; set it explicitly): API max 50 instances × 10 + worker max 10 × 10 + 20 = 620. Beyond that, put Cloud SQL Managed Connection Pooling (or PgBouncer in transaction mode) in front: our tenant context is transaction-local (`set_config(…, true)`), so transaction pooling is safe.

Guards on every pooled connection: `statement_timeout` 15 s (worker may raise it via `DATABASE_STATEMENT_TIMEOUT_MS`), `idle_in_transaction_session_timeout` 30 s, pool acquire timeout 5 s (fail fast instead of queueing), connections recycled every 30 min, `application_name` = `mizan-api` / `mizan-worker`. Slow statements (≥ 500 ms) are logged with their SQL text only, never parameters.

## 6. Backups and recovery

- Cloud SQL automated backups daily, 30-day retention; PITR 7 days.
- Monthly restore drill into a scratch instance; record time to restore.
- Targets: RPO ≤ 15 min, RTO ≤ 4 h.
- Object storage: versioning on exports bucket.

## 7. Runbooks (write in `docs/runbooks/` as incidents teach us)

- Provider outage (Bosta down): circuit open → jobs back off automatically; tell merchants via status banner; nothing to replay unless jobs dead-lettered.
- Revoked token: connection → `needs_attention`; owner notified (email + in-app) to reconnect; replay dead letters after.
- Schema drift alert: read drift report; update adapter candidate paths; add a test with the new payload shape; deploy.
- Dead-letter spike: group by `last_error`; fix cause; bulk replay.
- Database restore: follow Cloud SQL PITR steps; re-run reconciliation polls for the gap window.

## 8. Cost control

Set budget alerts per project. Start small: Cloud SQL 2 vCPU HA, Cloud Run min instances only for API and worker. Review monthly against tenant count (`docs/01-business-model.md` §13).
