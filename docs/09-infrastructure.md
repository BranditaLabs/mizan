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

All config through environment variables, validated at startup with zod (`apps/api/src/platform/config.ts`). Root `.env.example` lists them. Groups:

```
DATABASE_URL, DATABASE_URL_MIGRATOR
FIREBASE_PROJECT_ID, GOOGLE_APPLICATION_CREDENTIALS (local only)
KMS_KEY_NAME
PUBLIC_URL, WEB_URL
SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_API_VERSION=2026-10, SHOPIFY_SCOPES
PAYMOB_* (platform-level config only; merchant keys live in the secrets table)
BOSTA_BASE_URL, BOSTA_TRACKING_URL_TEMPLATE
META_APP_ID, META_APP_SECRET, WHATSAPP_VERIFY_TOKEN
SENTRY_DSN, LOG_LEVEL
```

Per-merchant credentials (Bosta key, Shopify token) live in the `secrets` table, never in env.

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
