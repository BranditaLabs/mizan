# 09 — Infrastructure, environments and operations

## 1. Environments

| Env | Purpose | Data | Providers |
| --- | --- | --- | --- |
| `local` | Development | Docker Postgres or PGlite; fakes for all providers | Fakes (`packages/engine/test/fakes`) |
| `staging` | Integration testing, demos | Synthetic + test stores | Shopify dev store, Bosta staging, Meta test numbers, Paymob test keys |
| `production` | Merchants | Real | Live credentials |

Each environment uses a separate Azure subscription and resource group (`rg-mizan-staging`,
`rg-mizan-production`) in UAE North (`uaenorth`).

## 2. Azure layout (production)

| Component | Service | Notes |
| --- | --- | --- |
| API | Azure Container Apps (`ca-mizan-api`) | Min 2 production replicas; external HTTPS ingress |
| Worker | Azure Container Apps (`ca-mizan-worker`) | Min 1 replica; shares the API managed identity |
| Web | Azure Container Apps (`ca-mizan-web`) | Next.js standalone output (`apps/web`) |
| Migrations | Container Apps Job (`caj-mizan-migrate`) | Manually triggered by CI before app updates; schema owner |
| Database | Azure Database for PostgreSQL Flexible Server 16 | Zone-redundant HA in production; 14-day backups; TLS required |
| Secrets | Azure Key Vault (RBAC) | Generated application secrets; per-secret access for runtime identities |
| Merchant credentials | Azure Key Vault RSA 3072 key (`tenant-secrets`) | API identity can wrap/unwrap data keys |
| Images | Azure Container Registry (Basic) | Admin user disabled; runtime identities have AcrPull |
| Files | Azure Blob Storage (not provisioned by this Terraform yet) | Signed URLs and lifecycle rules when file storage is implemented |
| Logs and metrics | Azure Monitor + Log Analytics | PII redaction remains in the application logger |
| Errors | Sentry (or Error Reporting) | Scrub PII |

Infrastructure as code: Terraform in `infra/`; `infra/bootstrap.sh` runs from Azure Cloud Shell,
creates the versioned Azure Storage backend, provisions the environment and creates a GitHub OIDC
deploy identity. PostgreSQL permits Azure services through the 0.0.0.0 firewall rule only when
`db_allow_azure_services` is on (staging; production temporarily, with a Terraform warning); Key
Vault keeps a public endpoint behind Entra RBAC because Container Apps without a VNet have no
stable egress IPs. Production must move both to private VNet integration and remove that rule. The worker runs its
own polls; no scheduler is provisioned.

### Container image (✅ H-10)

One image for API, worker and migrations (`Dockerfile` at the repo root, ADR-0003):

| Stage | Base | Does |
| --- | --- | --- |
| `build` | `node:22.22.0-bookworm-slim` | `npm ci` + `npm run build` for every workspace |
| `prod-deps` | same | `npm ci --omit=dev -w @mizan/api` (the API's runtime dependencies and the workspace packages it links) |
| `runtime` | `gcr.io/distroless/nodejs22-debian12:nonroot` | `dist/` + migrations + production `node_modules`; no shell, no npm; uid 65532; code owned by root (read-only to the process) |

| Run | Command (node is the entrypoint) |
| --- | --- |
| API (Container App `ca-mizan-api`) | default: `apps/api/dist/main.js` |
| Worker (Container App `ca-mizan-worker`) | `apps/api/dist/worker.js`, listens on `PORT` for `/health` and `/metrics` |
| Migrations (Container Apps Job, before deploy) | `packages/db/dist/cli.js migrate` with `DATABASE_URL_MIGRATOR` |

The image sets `NODE_ENV=production` and `LOG_FORMAT=json`. Keep the Node version of both bases in step (Renovate groups them). Behind a TLS-intercepting proxy, build with `--secret id=ca,src=<ca.crt>`; registries that rate-limit Docker Hub can be swapped with `--build-arg NODE_IMAGE=mirror.gcr.io/library/node:22.22.0-bookworm-slim`.

**Prod-like local stack:** `docker compose up --build` runs PostgreSQL 16 (roles from `deploy/compose/initdb.sql`: the API logs in as `mizan_api`, member of `mizan_app` and `mizan_worker`, never the owner), the migration job, the API on :8080 and the worker on :8081, read-only root filesystem, all capabilities dropped. `deploy/compose/smoke.sh` checks readiness, nonroot user, auth on `/v1` and `/metrics`, metrics on both processes, JSON logs and a clean SIGTERM exit; CI runs it on every PR (job `image`).

## 3. Configuration

All config through environment variables, validated at startup with zod (`apps/api/src/platform/config.ts`, ✅ built in E1-3). An invalid environment exits with code 1 and one line per bad variable (names and reasons, never values). `apps/api/.env.example` lists what the API reads today; the root `.env.example` is for the standalone engine only. Groups (target):

```
DATABASE_URL (postgres:// · unset or pglite:<dir> in dev/test), DATABASE_URL_MIGRATOR, DATABASE_POOL_MAX
FIREBASE_PROJECT_ID, FIREBASE_AUTH_EMULATOR_HOST (dev/e2e only; refused in production)
KEY_VAULT_KEY_ID (versionless tenant-secrets key id) and AZURE_CLIENT_ID (user-assigned identity, Azure only)
SECRETS_DEV_KEY = base64 32 bytes for local dev only
LINK_SIGNING_KEY (required in production: base64 of 32 random bytes, signs customer confirmation links; rotating it breaks links already sent)
MESSAGING_PROVIDER (none = confirmation links sent by hand; log = development only)
PUBLIC_URL, WEB_URL, ADMIN_URL (the back office, apps/admin: allowed by CORS), PLATFORM_BOOTSTRAP_EMAILS (first super admin)
SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_API_VERSION=2026-10, SHOPIFY_SCOPES
PAYMOB_* (platform-level config only; merchant keys live in the secrets table)
BOSTA_BASE_URL, BOSTA_TRACKING_URL_TEMPLATE, WORKER_IN_PROCESS (dev only)
META_APP_SECRET (signs WhatsApp webhooks), WHATSAPP_VERIFY_TOKEN (Meta's subscription check), WHATSAPP_GRAPH_VERSION=v24.0, WHATSAPP_GRAPH_URL (tests only)
SENTRY_DSN, LOG_LEVEL, LOG_FORMAT
```

Per-merchant credentials (Bosta key, Shopify token) live in the `secrets` table, never in env.

**Web (`apps/web`, build time):** `NEXT_PUBLIC_API_URL` and the Firebase web config `NEXT_PUBLIC_FIREBASE_{API_KEY,AUTH_DOMAIN,PROJECT_ID}` (public by design; restrict the API key to the web origins and Identity Toolkit API in Google Cloud). `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL` only for local development and the `web-e2e` job. See `apps/web/.env.example`.

**Database roles:** migrations run as the schema owner (`DATABASE_URL_MIGRATOR`, `mizan-db migrate`); with `DATABASE_APP_LOGIN` + `DATABASE_APP_PASSWORD` the same run creates or updates the API login. The API and worker log in as a separate user that is a member of `mizan_app` (tenant data under RLS), `mizan_worker` (event dispatch across tenants on `domain_events` only) and `mizan_platform` (the back office's cross-store reads), and is neither owner nor `BYPASSRLS`. The migrator is not a superuser on Azure: it creates the login once (`NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`) and afterwards only sets its password, refusing to continue if the login ever gained `SUPERUSER` or `BYPASSRLS`.

**Own domains (`infra/domains.tf`):** domains bind directly to Azure Container Apps; no load balancer is used. Terraform prints the CNAME target (the app FQDN) and TXT record (`asuid.<host>` equals the app's custom-domain verification id). DNS stays at Hostinger. Add both records first, set `bind_custom_domains = true`, then re-run `infra/bootstrap.sh`: Terraform adds the hostname and issues the free managed certificate, and the script binds it (`az containerapp hostname bind`, SNI), which Terraform cannot do. `PUBLIC_URL`, `WEB_URL` and `ADMIN_URL` use the domains only once they are bound; before that they are the Container Apps FQDNs. Staging uses `api.mizan.brandita.net` and `app.mizan.brandita.net`; the dashboard build uses the GitHub variable `API_URL` when set (set it to the custom domain after binding).

## 4. CI/CD (GitHub Actions)

| Workflow | Trigger | Steps |
| --- | --- | --- |
| `ci.yml` ✅ | PR, push to `main` | job `build-test`: `npm ci` → typecheck → build → tests for all workspaces (engine incl. chaos suite, db schema + RLS, api against PGlite and Postgres). Lint runs in `build-test`. Job `web-e2e`: Playwright smoke of the dashboard's production build (Arabic default, RTL/LTR, theme cookie, system dark, security headers, no external requests). Job `image`: build the production image, `docker compose up`, `deploy/compose/smoke.sh`. Job `ops-app`: Flutter 3.47.9 in `apps/ops` — generated code (drift, l10n) must be current, `flutter analyze`, `flutter test` (incl. the offline-sync chaos run). Job `secrets-scan`: gitleaks over full history. |
| `nightly-load.yml` ✅ | Daily 03:17 Cairo, manual | Build, then `npm run load -w @mizan/perf` (2 API instances, 2,000 stores, Postgres service); fails on a missed latency/throughput gate or a lost webhook; table in the job summary, JSON as artifact |
| `deploy-staging.yml` ✅ | Merge to `main`, manual | Azure OIDC (no client secrets) → build `api` and `web` images → push to ACR → migration Container Apps Job (must succeed) → update worker, API, dashboard → smoke test (`/health/ready`, 401 on `/v1/me`, `/ar` in RTL). Skipped until `infra/bootstrap.sh` has run and its variables are set |
| `deploy-prod.yml` ✅ | Git tag `v*` (approval by the `production` environment's reviewers) | same as staging, against production; migrations must be backward compatible with the previous release |
| `ops-app.yml` | Tag `ops-v*` | Flutter build → Play internal track / TestFlight |

Branching: trunk-based, short-lived feature branches, PR review required, squash merge. Conventional commits.

**Branch protection for `main`** (set by a repo admin in GitHub → Settings → Branches, or as a ruleset):

- Require a pull request before merging, 1 approval, dismiss stale approvals on new commits.
- Required status checks: `Typecheck and test`, `Web smoke test (RTL/LTR, themes)`, `Production image smoke test`, `Secret scan (gitleaks)`; require branches to be up to date.
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

Each API instance serves `GET /metrics` (Prometheus text format, outside `/v1`); the worker listens on `PORT` for `GET /health` and `GET /metrics` only (engine jobs, and so provider circuits, live there). It is internal: it answers 404 unless `METRICS_TOKEN` is set, then requires `Authorization: Bearer <METRICS_TOKEN>` (compared in constant time). Azure Monitor managed Prometheus collection is deferred until its collector is deployed. Labels never carry tenant ids, user ids, phones or raw paths: HTTP routes are labelled by template (`/v1/members/:userId`), requests that match no route are `unmatched`, `status` is the class (`2xx`…`5xx`, exact code only on `mizan_webhooks_total`), and webhook providers outside the known set are `other`.

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

Business alert expressions below are PromQL for the future Azure Monitor managed Prometheus setup. `infra/monitoring.tf` currently provisions Azure Monitor standard availability tests and metric alerts for Container Apps and PostgreSQL; `app_metrics_enabled` documents the future app-level alert integration.

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

### Capacity planning (from H-11)

Measured per API process (1 core, shared VM, `docs/perf/README.md`): ~450 webhooks/s or ~400 authenticated reads/s at saturation; latency targets hold with wide margin at half of that. Container Apps start at **1 vCPU / 2 GiB**; scale limits are per environment in Terraform and must be adjusted after **H-13** load testing. One Node process per replica (no in-process cluster): rate limits, caches and metrics stay per replica as designed. Keep maximum API and worker replicas × `DATABASE_POOL_MAX` within the §5b budget.

## 5a. Table hygiene (✅ H-7)

The worker prunes high-churn tables every 10 minutes in batches (5,000 rows × up to 20 batches per table per run): finished engine jobs after `RETENTION_JOBS_DAYS` (7), webhook dedupe keys after `RETENTION_WEBHOOK_KEYS_DAYS` (14; providers retry for ≤ 48 h), dispatched domain events after `RETENTION_EVENTS_DAYS` (30), expired idempotency keys, claimed or expired pending Shopify installs. Pending, running and dead work is never pruned.

The worker also stores daily exchange rates (E9-1): every `FX_REFRESH_MINUTES` (60) it checks whether today's USD rates are in and, if not, fetches them once from `FX_SOURCE` (`open-er-api`; `none` turns it off, the default in tests). Egress to `open.er-api.com:443` must be allowed; a failed fetch keeps the stored rates (lookups fall back up to 7 days, marked stale) and counts `mizan_fx_refresh_total{result="failed"}` (alert if no `stored` for 48 h). At 10× scale (10M orders/month ≈ 50M engine jobs/month) the outbox holds about a week of done jobs (~12M rows), indexed for the due queries only.

## 5b. Database connection budget (✅ H-8)

Every process opens at most `DATABASE_POOL_MAX` connections (default 10). Keep

    (API max replicas × API pool) + (worker max replicas × worker pool) + 20 (migrations, admin, monitoring) ≤ PostgreSQL max_connections

Reference for the 10× target: PostgreSQL Flexible Server with max connections explicitly set: API max 50 replicas × 10 + worker max 10 × 10 + 20 = 620. Beyond that, put PgBouncer in transaction mode in front: our tenant context is transaction-local (`set_config(…, true)`), so transaction pooling is safe.

Guards on every pooled connection: `statement_timeout` 15 s (worker may raise it via `DATABASE_STATEMENT_TIMEOUT_MS`), `idle_in_transaction_session_timeout` 30 s, pool acquire timeout 5 s (fail fast instead of queueing), connections recycled every 30 min, `application_name` = `mizan-api` / `mizan-worker`. Slow statements (≥ 500 ms) are logged with their SQL text only, never parameters.

## 6. Backups and recovery

Restore runbook and quarterly drill: `docs/runbooks/database-restore.md` (✅ E13-1).


- Azure Database for PostgreSQL automated backups with 14-day retention; geo-redundant backups are disabled.
- Monthly restore drill into a scratch instance; record time to restore.
- Targets: RPO ≤ 15 min, RTO ≤ 4 h.
- Object storage: versioning on exports bucket.

## 7. Runbooks (write in `docs/runbooks/` as incidents teach us)

- Provider outage (Bosta down): circuit open → jobs back off automatically; tell merchants via status banner; nothing to replay unless jobs dead-lettered.
- Revoked token: connection → `needs_attention`; owner notified (email + in-app) to reconnect; replay dead letters after.
- Schema drift alert: read drift report; update adapter candidate paths; add a test with the new payload shape; deploy.
- Dead-letter spike: group by `last_error`; fix cause; bulk replay.
- Database restore: follow Azure PostgreSQL Flexible Server PITR steps; re-run reconciliation polls for the gap window.

## 8. Cost control

Set Azure budgets per subscription. Start small: PostgreSQL 2 vCPU HA, Container Apps minimum replicas only for API and worker. Review monthly against tenant count (`docs/01-business-model.md` §13).
