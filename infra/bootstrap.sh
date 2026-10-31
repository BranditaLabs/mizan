#!/usr/bin/env bash
# Bootstrap one Mizan environment from Azure Cloud Shell (az and terraform are preinstalled):
#
#   bash infra/bootstrap.sh <subscription-id> [location=uaenorth] [env=staging]
#
# The state container is private and versioned; shared-key access is off and the operator reads it
# through Entra RBAC. GitHub deploys with OIDC; no client secret is created. Terraform-generated
# passwords and application keys are stored in Key Vault/state. Safe to re-run: the second run
# (after the DNS records and bind_custom_domains = true) also binds the managed certificates.
set -euo pipefail

SUBSCRIPTION_ID="${1:?usage: bash infra/bootstrap.sh <subscription-id> [location] [env]}"
LOCATION="${2:-uaenorth}"
ENV="${3:-staging}"
REPO="BranditaLabs/mizan"
STATE_RG="rg-mizan-tfstate"
STATE_CONTAINER="tfstate"

if [[ "${ENV}" != "staging" && "${ENV}" != "production" ]]; then
  echo "env must be staging or production" >&2
  exit 1
fi

# Deploy jobs declare `environment:`, so GitHub's OIDC subject is the environment, not the ref.
# Which refs may use an environment is enforced by its deployment branch/tag rule (printed below).
if [[ "${ENV}" == "staging" ]]; then
  GITHUB_ENV_NAME="staging"
  DEPLOY_FLAG="AZURE_DEPLOY_STAGING"
  DEPLOY_RULE="Selected branches and tags, branch rule: main"
else
  GITHUB_ENV_NAME="production"
  DEPLOY_FLAG="AZURE_DEPLOY_PRODUCTION"
  DEPLOY_RULE="Selected branches and tags, tag rule: v*"
fi
FEDERATED_SUBJECT="repo:${REPO}:environment:${GITHUB_ENV_NAME}"

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

az account set --subscription "${SUBSCRIPTION_ID}"
TENANT_ID="$(az account show --query tenantId -o tsv)"

say "Registering Azure resource providers"
for namespace in \
  Microsoft.App \
  Microsoft.Authorization \
  Microsoft.ContainerRegistry \
  Microsoft.DBforPostgreSQL \
  Microsoft.Insights \
  Microsoft.KeyVault \
  Microsoft.ManagedIdentity \
  Microsoft.Monitor \
  Microsoft.OperationalInsights \
  Microsoft.Storage
do
  az provider register --namespace "${namespace}" --wait >/dev/null
done

STATE_SUFFIX="$(printf '%s' "${SUBSCRIPTION_ID}" | sha256sum | cut -c1-8)"
STATE_ACCOUNT="mztfstate${STATE_SUFFIX}"
say "Creating the private, versioned Terraform state container"
if ! az group show --name "${STATE_RG}" >/dev/null 2>&1; then
  az group create --name "${STATE_RG}" --location "${LOCATION}" --output none
fi
if ! az storage account show --name "${STATE_ACCOUNT}" --resource-group "${STATE_RG}" >/dev/null 2>&1; then
  az storage account create \
    --name "${STATE_ACCOUNT}" \
    --resource-group "${STATE_RG}" \
    --location "${LOCATION}" \
    --sku Standard_LRS \
    --kind StorageV2 \
    --https-only true \
    --min-tls-version TLS1_2 \
    --allow-blob-public-access false \
    --allow-shared-key-access false \
    --output none
fi
# State holds generated passwords: no account keys, Entra RBAC only.
az storage account update \
  --name "${STATE_ACCOUNT}" \
  --resource-group "${STATE_RG}" \
  --allow-shared-key-access false \
  --output none
az storage account blob-service-properties update \
  --account-name "${STATE_ACCOUNT}" \
  --resource-group "${STATE_RG}" \
  --enable-versioning true \
  --enable-delete-retention true \
  --delete-retention-days 30 \
  --enable-container-delete-retention true \
  --container-delete-retention-days 30 \
  --output none

# Subscription Owner/Contributor carry no blob data actions; the container commands and the
# azurerm backend (use_azuread_auth) need Storage Blob Data Contributor on the account.
STATE_ACCOUNT_ID="$(az storage account show --name "${STATE_ACCOUNT}" --resource-group "${STATE_RG}" --query id -o tsv)"
OPERATOR_OBJECT_ID="$(az ad signed-in-user show --query id -o tsv)"
if [[ -z "$(az role assignment list --scope "${STATE_ACCOUNT_ID}" --assignee-object-id "${OPERATOR_OBJECT_ID}" --query "[?roleDefinitionName=='Storage Blob Data Contributor'].id | [0]" -o tsv)" ]]; then
  az role assignment create \
    --assignee-object-id "${OPERATOR_OBJECT_ID}" \
    --assignee-principal-type User \
    --role "Storage Blob Data Contributor" \
    --scope "${STATE_ACCOUNT_ID}" \
    --output none
fi
say "Waiting for the state account's data-plane role to propagate"
for attempt in $(seq 1 30); do
  if az storage container list --account-name "${STATE_ACCOUNT}" --auth-mode login --num-results 1 --output none 2>/dev/null; then
    break
  fi
  if [[ "${attempt}" == 30 ]]; then
    echo "Storage Blob Data Contributor has not propagated after 5 minutes; re-run this script." >&2
    exit 1
  fi
  sleep 10
done
if ! az storage container show --account-name "${STATE_ACCOUNT}" --name "${STATE_CONTAINER}" --auth-mode login >/dev/null 2>&1; then
  az storage container create \
    --account-name "${STATE_ACCOUNT}" \
    --name "${STATE_CONTAINER}" \
    --auth-mode login \
    --public-access off \
    --output none
fi

say "Applying Azure infrastructure (${ENV}, ${LOCATION})"
terraform -chdir=infra init -input=false -reconfigure \
  -backend-config="resource_group_name=${STATE_RG}" \
  -backend-config="storage_account_name=${STATE_ACCOUNT}" \
  -backend-config="container_name=${STATE_CONTAINER}" \
  -backend-config="key=mizan/${ENV}.tfstate"
terraform -chdir=infra apply -input=false -auto-approve \
  -var-file="envs/${ENV}.tfvars" \
  -var="subscription_id=${SUBSCRIPTION_ID}" \
  -var="region=${LOCATION}"

# Terraform adds each hostname and issues its managed certificate; the SNI binding is done here
# (az reuses the environment's managed certificate for the hostname). Idempotent.
BINDINGS="$(terraform -chdir=infra output -json custom_domain_bindings | jq -r 'to_entries[] | [.value.app, .value.hostname] | @tsv')"
if [[ -n "${BINDINGS}" ]]; then
  say "Binding custom domains to their managed certificates"
  BIND_RG="$(terraform -chdir=infra output -raw resource_group)"
  CAE_NAME="$(terraform -chdir=infra output -raw container_app_environment)"
  while IFS=$'\t' read -r app hostname; do
    az containerapp hostname bind \
      --resource-group "${BIND_RG}" \
      --name "${app}" \
      --hostname "${hostname}" \
      --environment "${CAE_NAME}" \
      --validation-method CNAME \
      --output none
    echo "  bound https://${hostname}"
  done <<< "${BINDINGS}"
fi

RESOURCE_GROUP="$(terraform -chdir=infra output -raw resource_group)"
ACR_ID="$(az acr show --name "$(terraform -chdir=infra output -raw acr_name)" --resource-group "${RESOURCE_GROUP}" --query id -o tsv)"
ACR_NAME="$(terraform -chdir=infra output -raw acr_name)"
RESOURCE_GROUP_ID="$(az group show --name "${RESOURCE_GROUP}" --query id -o tsv)"

say "Creating the GitHub OIDC deploy identity"
APP_NAME="mizan-${ENV}-github-deploy"
APP_ID="$(az ad app list --display-name "${APP_NAME}" --query '[0].appId' -o tsv)"
if [[ -z "${APP_ID}" || "${APP_ID}" == "None" ]]; then
  APP_ID="$(az ad app create --display-name "${APP_NAME}" --query appId -o tsv)"
fi
APP_OBJECT_ID="$(az ad app show --id "${APP_ID}" --query id -o tsv)"
if ! az ad sp show --id "${APP_ID}" >/dev/null 2>&1; then
  az ad sp create --id "${APP_ID}" --output none
fi
SP_OBJECT_ID="$(az ad sp show --id "${APP_ID}" --query id -o tsv)"

FEDERATED_NAME="github-${ENV}"
FEDERATED_ISSUER="https://token.actions.githubusercontent.com"
FEDERATED_AUDIENCE="api://AzureADTokenExchange"
FEDERATED_PARAMS="{\"name\":\"${FEDERATED_NAME}\",\"issuer\":\"${FEDERATED_ISSUER}\",\"subject\":\"${FEDERATED_SUBJECT}\",\"audiences\":[\"${FEDERATED_AUDIENCE}\"]}"
EXISTING_CREDENTIAL="$(az ad app federated-credential list --id "${APP_OBJECT_ID}" --query "[?name=='${FEDERATED_NAME}'] | [0] | join('|', [subject, issuer, join(',', audiences)])" -o tsv 2>/dev/null || true)"
if [[ -z "${EXISTING_CREDENTIAL}" ]]; then
  az ad app federated-credential create --id "${APP_OBJECT_ID}" --parameters "${FEDERATED_PARAMS}" --output none
elif [[ "${EXISTING_CREDENTIAL}" != "${FEDERATED_SUBJECT}|${FEDERATED_ISSUER}|${FEDERATED_AUDIENCE}" ]]; then
  # Reconcile a credential left by an earlier run (wrong subject, renamed repo).
  az ad app federated-credential update \
    --id "${APP_OBJECT_ID}" \
    --federated-credential-id "${FEDERATED_NAME}" \
    --parameters "${FEDERATED_PARAMS}" \
    --output none
fi

ensure_role() {
  local role="$1"
  local scope="$2"
  if [[ -z "$(az role assignment list --scope "${scope}" --assignee-object-id "${SP_OBJECT_ID}" --query "[?roleDefinitionName=='${role}'].id | [0]" -o tsv)" ]]; then
    az role assignment create \
      --assignee-object-id "${SP_OBJECT_ID}" \
      --assignee-principal-type ServicePrincipal \
      --role "${role}" \
      --scope "${scope}" \
      --output none
  fi
}

ensure_role "AcrPush" "${ACR_ID}"
# Contributor is limited to this environment's resource group because Container Apps deploys
# update services/jobs and revisions; it cannot change subscriptions or other environments.
# TODO(before launch): replace with a custom role (containerApps/jobs write, jobs/start, identity
# assign) once verified against a live deploy; Contributor can also change the database and Key
# Vault settings in this resource group.
ensure_role "Contributor" "${RESOURCE_GROUP_ID}"

API_URL="$(terraform -chdir=infra output -raw api_url)"
FIREBASE_PROJECT_ID="$(grep -E '^firebase_project_id[[:space:]]*=' "infra/envs/${ENV}.tfvars" | head -1 | cut -d '"' -f2 || true)"
FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID:-mizan-8f906}"
FIREBASE_AUTH_DOMAIN="${FIREBASE_PROJECT_ID}.firebaseapp.com"

say "Done. Add these GitHub environment variables in ${GITHUB_ENV_NAME}:"
cat <<EOF
  AZURE_CLIENT_ID       = ${APP_ID}
  AZURE_TENANT_ID       = ${TENANT_ID}
  AZURE_SUBSCRIPTION_ID = ${SUBSCRIPTION_ID}
  AZURE_RESOURCE_GROUP  = ${RESOURCE_GROUP}
  ACR_NAME              = ${ACR_NAME}
  FIREBASE_API_KEY      = (copy the public web API key from Firebase console; do not paste it in chat)
  FIREBASE_AUTH_DOMAIN  = ${FIREBASE_AUTH_DOMAIN}
  FIREBASE_PROJECT_ID   = ${FIREBASE_PROJECT_ID}
  API_URL               = ${API_URL}
EOF
echo "API_URL is the Container Apps FQDN until the custom domains are bound; re-running this script after binding prints the custom domain."
say "Then, in GitHub settings:"
cat <<EOF
  Repository variable (Secrets and variables > Actions > Variables): ${DEPLOY_FLAG} = true
    (a job-level condition cannot read environment variables, so this switch is repository-level)
  Environments > ${GITHUB_ENV_NAME} > Deployment branches and tags: ${DEPLOY_RULE}
EOF

say "Complete the custom-domain DNS step if domains are configured"
echo "Add these CNAME and asuid TXT records at Hostinger, set bind_custom_domains = true, then re-run this script to apply and bind the managed certificates."
terraform -chdir=infra output -json dns_records

say "Provider secrets"
echo "Create values directly in Key Vault, add their names to provider_secrets in infra/envs/${ENV}.tfvars, and apply again:"
terraform -chdir=infra output -json provider_secrets_to_fill
echo "Keep the production GitHub environment protected with required reviewers and the v* tag rule. Firebase remains a separate identity service."
