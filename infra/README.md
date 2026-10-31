# infra — Mizan on Azure UAE North

Terraform provisions one environment per Azure subscription in `uaenorth`. `infra/bootstrap.sh`
is run from Azure Cloud Shell and creates the `azurerm` state backend, applies infrastructure,
then creates the GitHub OIDC identity. No deploy client secret is generated.

| What | Where |
| --- | --- |
| API, worker, dashboard | Azure Container Apps: `ca-mizan-api`, `ca-mizan-worker`, `ca-mizan-web` |
| Migrations | Manually triggered Container Apps Job `caj-mizan-migrate`, run before each deployment as `mizan_migrator`; it creates/updates `mizan_api` with RLS roles only |
| Database | Azure Database for PostgreSQL Flexible Server 16; 14-day backups, TLS required, 200 connections; zone-redundant HA in production |
| Secrets | Azure Key Vault with RBAC, soft delete and purge protection; public endpoint (no stable Container Apps egress IPs without a VNet), Entra RBAC only; generated database URLs, app password, link key and metrics token |
| Merchant credentials | RSA 3072 Key Vault key `tenant-secrets`; API identity has wrap/unwrap rights |
| Images | Basic Azure Container Registry, admin disabled; runtime identities have AcrPull |
| Deploys | `deploy-staging.yml` on `main`; `deploy-prod.yml` on `v*` tags only, after production environment approval; GitHub OIDC with the environment as subject, no client secrets |
| Monitoring | Azure Monitor action group, standard availability tests, metric alerts for API 5xx, worker replicas, per-app restarts and PostgreSQL CPU/storage/connections |
| Domains | Container Apps custom domains and free Azure managed certificates; DNS remains at Hostinger |

## First time

1. Open Azure Cloud Shell (signed in as a user who can create resources and role assignments, e.g. subscription Owner), clone the repository, and run:
   ```sh
   git clone https://github.com/BranditaLabs/mizan && cd mizan
   bash infra/bootstrap.sh <subscription-id> [uaenorth] [staging]
   ```
   Run once per environment, using `production` for the production subscription. The script gives you **Storage Blob Data Contributor** on the state account (shared keys are off) and waits for it. The first apply waits about two minutes twice for Key Vault and runtime role assignments to propagate; if Azure still answers 403, re-run the script (it is idempotent). The apps start on a placeholder image (`traefik/whoami` on port 8080) until the first CI deploy.
2. Add the printed values under **GitHub → Settings → Environments → staging** (or `production`) → **Environment variables**. They are identifiers; copy the Firebase web API key directly from Firebase Console. Then:
   - Add the **repository** variable `AZURE_DEPLOY_STAGING=true` (or `AZURE_DEPLOY_PRODUCTION=true`). A job-level `if` cannot read environment variables, so the deploy switch is repository-level.
   - Set the environment's **Deployment branches and tags** rule: staging → branch `main`; production → tag `v*`. The OIDC federated credential trusts the environment (`repo:BranditaLabs/mizan:environment:<env>`), so this rule is what keeps other refs out.
   - Add required reviewers to the production environment.
3. Configure Firebase Authentication providers as before (email/password, phone and SMS MFA), and add the dashboard domain to Firebase Authorized domains. Firebase Authentication remains the identity service.
4. The first run prints the CNAME and `asuid` TXT records. Until they are bound, `PUBLIC_URL`, `WEB_URL` and the printed `API_URL` are the Container Apps FQDNs. Add both records at Hostinger, set `bind_custom_domains = true` in the environment tfvars and **re-run `infra/bootstrap.sh`**: Terraform adds the hostnames and issues the managed certificates, then the script binds each one with `az containerapp hostname bind` (Terraform cannot set that SNI binding). Update `API_URL` in the GitHub environment to the printed custom domain and redeploy so the dashboard is rebuilt against it.
5. Push to `main` or publish a `v*` release tag. CI builds both images, runs the migration job, updates the apps and smoke-tests the deployment.

## Provider secrets

Create each actual value directly in Key Vault (never in chat or git). For example:

```sh
az keyvault secret set --vault-name <vault-name> --name shopify-api-secret --value '<value>'
```

Then list the corresponding environment name in `provider_secrets` in `envs/staging.tfvars` or `envs/production.tfvars`, and apply again. Provider secrets are not created with empty placeholder values, and the API receives access only to secrets listed there.

## Changes and validation

```sh
terraform -chdir=infra init \
  -backend-config="resource_group_name=<state-resource-group>" \
  -backend-config="storage_account_name=<state-storage-account>" \
  -backend-config="container_name=tfstate" \
  -backend-config="key=mizan/staging.tfstate"
terraform -chdir=infra plan -var-file=envs/staging.tfvars -var="subscription_id=<subscription-id>"
```

CI checks `terraform fmt -check -recursive`, `init -backend=false`, `validate`, and `bash -n infra/bootstrap.sh`. Container App images are created with a placeholder that serves `/health` and `/health/ready` on 8080 like the real images; CI owns subsequent image updates and waits for each new revision to be ready before the smoke test.

**Production:** use the production GitHub environment with required reviewers and the `v*` tag rule. The database is configured for zone-redundant HA and 14-day backups (Terraform ignores the zone swap after a failover). The PostgreSQL `0.0.0.0` Azure-services firewall rule is an explicit opt-in (`db_allow_azure_services`); production has it on only until the database, Key Vault and Container Apps move to private VNet integration, and a Terraform check warns on every production plan while it is on. The GitHub deploy identity has Contributor on the environment's resource group; replace it with a narrower custom role before launch.
