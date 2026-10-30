# infra — Mizan on Google Cloud (E1-11)

Terraform for one environment per project (`mizan-staging`, later `mizan-prod`) in the Middle East (`me-central1` Doha by default, or `me-central2` Dammam).

| What | Where |
| --- | --- |
| API, worker, dashboard | Cloud Run `mizan-api`, `mizan-worker` (CPU always on, internal only), `mizan-web` |
| Migrations | Cloud Run job `mizan-migrate`: runs as the schema owner, then creates or updates the API's login `mizan_api` (only `mizan_app` + `mizan_worker`, never BYPASSRLS) |
| Database | Cloud SQL PostgreSQL 16, PITR, 14 daily backups, reached only through the Cloud SQL connector (no authorized networks) |
| Secrets | Secret Manager: database URLs, link signing key, metrics token (generated); Shopify, Meta, WhatsApp, Anthropic, Sentry (you add the values) |
| Merchant credentials | Cloud KMS key `tenant-secrets` (90-day rotation) wraps each secret's data key |
| Files | Cloud Storage `<project>-files`, private, 180-day lifecycle |
| Images | Artifact Registry `mizan` (`api`, `web`), last 20 kept |
| Deploys | `deploy-staging.yml` on every push to `main`; `deploy-prod.yml` on a release tag `v*` after the `production` environment's reviewers approve; both through Workload Identity Federation (no keys; staging trusts `main`, production only `v*` tags) |
| Monitoring (`monitoring.tf`) | Uptime checks (API readiness, `/ar`), alerts on API 5xx > 1 %, p95 latency, worker down, Cloud SQL CPU/disk/connections and error logs, emailed to `alert_emails`; a "Mizan <env>" dashboard. The app-level alerts of docs/09 §5 (outbox lag, dead letters, webhook ack, open circuits…) turn on with `app_metrics_enabled = true` once Managed Prometheus scrapes `/metrics` |

## First time (about 20 minutes, once per environment)

1. Create the project in the Google Cloud console and link billing.
2. Open **Cloud Shell** (it is signed in as you and has `gcloud` and `terraform`), then:
   ```
   git clone https://github.com/BranditaLabs/mizan && cd mizan
   bash infra/bootstrap.sh <project-id> me-central1 staging
   ```
3. Add the GitHub variables it prints under **Settings → Environments → staging** (or **production**) **→ Environment variables**; they are identifiers, not secrets. `MIZAN_ENV` keeps each workflow on its own project. For production, also add **Required reviewers** to the environment.
4. Firebase: add Firebase to the same project; Authentication → Email/Password and Phone; upgrade to Identity Platform and turn on SMS multi-factor; add the dashboard URL to Authorized domains.
5. Push to `main` (or run the workflow by hand): build → migrate → deploy → smoke test.

Provider secrets, when you have them: `printf %s "<value>" | gcloud secrets versions add mizan-shopify-api-secret --data-file=-`, list the name in `provider_secrets` in `envs/staging.tfvars`, and `terraform apply` again. Never paste them into chat or commit them.

## Changing it

```
terraform -chdir=infra init -backend-config="bucket=<project>-tfstate"
terraform -chdir=infra plan -var-file=envs/staging.tfvars -var="project_id=<project>"
```

CI runs `fmt`, `init -backend=false` and `validate` on every PR (job `infra`). Images are deployed by the workflow; Terraform ignores them after creating each service on a placeholder.

**Production:** `bash infra/bootstrap.sh <prod-project> me-central1 production` (or `me-central2` for a Saudi project) uses `envs/production.tfvars`: HA Cloud SQL, 2 warm API instances, p95 alert at 300 ms. Release with `git tag v1.0.0 && git push --tags`, then approve in GitHub. Restores: `docs/runbooks/database-restore.md` (drill every quarter). **Still to do:** private IP for Cloud SQL, an HTTPS load balancer with Cloud Armor and the mapped domains, tiers from the H-13 load test.
