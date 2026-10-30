#!/usr/bin/env bash
# One-time setup of a Mizan environment on Google Cloud (E1-11). Run it yourself in Google Cloud
# Shell (already signed in as you, with gcloud and terraform), from a clone of the repo:
#
#   git clone https://github.com/BranditaLabs/mizan && cd mizan
#   bash infra/bootstrap.sh <project-id> [region] [env]      # e.g. mizan-staging me-central1 staging
#
# It is safe to run again. It creates no keys: GitHub Actions deploys through Workload Identity
# Federation (short-lived tokens for this repository's main branch only). Nothing secret is
# printed; database passwords and signing keys go straight into Secret Manager.
set -euo pipefail

PROJECT="${1:?usage: bash infra/bootstrap.sh <project-id> [region] [env]}"
REGION="${2:-me-central1}"
ENV="${3:-staging}"
REPO="BranditaLabs/mizan"
POOL="github"
PROVIDER="mizan-repo"
DEPLOYER="mizan-deployer"
STATE_BUCKET="${PROJECT}-tfstate"
# Staging deploys from main; any other environment only from a release tag (v1.2.3), approved in GitHub.
if [[ "${ENV}" == "staging" ]]; then
  REF_CONDITION="assertion.ref == 'refs/heads/main'"
  GITHUB_ENV_NAME="staging"
else
  REF_CONDITION="assertion.ref.startsWith('refs/tags/v')"
  GITHUB_ENV_NAME="production"
fi

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

say "Project ${PROJECT} (${ENV}) in ${REGION}"
gcloud config set project "${PROJECT}" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT}" --format='value(projectNumber)')"
if [[ "$(gcloud billing projects describe "${PROJECT}" --format='value(billingEnabled)' 2>/dev/null || true)" == "False" ]]; then
  echo "Billing is not enabled on ${PROJECT}. Link a billing account first (Console → Billing), then run this again." >&2
  exit 1
fi

say "Enabling the APIs Terraform and the deploy need"
gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com iam.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com storage.googleapis.com run.googleapis.com \
  artifactregistry.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com cloudkms.googleapis.com

say "Terraform state bucket gs://${STATE_BUCKET} (versioned, private)"
if ! gcloud storage buckets describe "gs://${STATE_BUCKET}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${STATE_BUCKET}" --location="${REGION}" --uniform-bucket-level-access --public-access-prevention
fi
gcloud storage buckets update "gs://${STATE_BUCKET}" --versioning >/dev/null

say "Infrastructure (terraform apply: Cloud SQL takes ~10 minutes the first time)"
terraform -chdir=infra init -input=false -reconfigure -backend-config="bucket=${STATE_BUCKET}"
terraform -chdir=infra apply -input=false -var-file="envs/${ENV}.tfvars" -var="project_id=${PROJECT}" -var="region=${REGION}"

say "Deployer identity for GitHub Actions (no keys)"
if ! gcloud iam workload-identity-pools describe "${POOL}" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "${POOL}" --location=global --display-name="GitHub Actions"
fi
if ! gcloud iam workload-identity-pools providers describe "${PROVIDER}" --workload-identity-pool="${POOL}" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER}" --workload-identity-pool="${POOL}" --location=global \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository == '${REPO}' && ${REF_CONDITION}"
fi
if ! gcloud iam service-accounts describe "${DEPLOYER}@${PROJECT}.iam.gserviceaccount.com" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${DEPLOYER}" --display-name="Mizan deploys from GitHub Actions"
fi
DEPLOYER_EMAIL="${DEPLOYER}@${PROJECT}.iam.gserviceaccount.com"
gcloud iam service-accounts add-iam-policy-binding "${DEPLOYER_EMAIL}" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}" >/dev/null
for role in roles/run.developer roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "${PROJECT}" --member="serviceAccount:${DEPLOYER_EMAIL}" --role="${role}" --condition=None >/dev/null
done
# Deploying a service or job as its runtime identity needs actAs on that identity only.
for sa in mizan-api mizan-web mizan-migrate; do
  gcloud iam service-accounts add-iam-policy-binding "${sa}@${PROJECT}.iam.gserviceaccount.com" \
    --member="serviceAccount:${DEPLOYER_EMAIL}" --role=roles/iam.serviceAccountUser >/dev/null
done

WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
say "Done. In GitHub → BranditaLabs/mizan → Settings → Environments → ${GITHUB_ENV_NAME} → Environment variables, add:"
cat <<EOF
  MIZAN_ENV          = ${GITHUB_ENV_NAME}
  GCP_PROJECT_ID     = ${PROJECT}
  GCP_REGION         = ${REGION}
  GCP_WIF_PROVIDER   = ${WIF_PROVIDER}
  GCP_DEPLOYER_SA    = ${DEPLOYER_EMAIL}
  FIREBASE_API_KEY   = (Firebase console → Project settings → Your apps → Web app → apiKey; public by design)
  FIREBASE_AUTH_DOMAIN = ${PROJECT}.firebaseapp.com
(These are identifiers, not secrets.) $( [[ "${GITHUB_ENV_NAME}" == "staging" ]] && echo "The next push to main builds, migrates and deploys." || echo "For production also add Required reviewers to the environment; a release tag (git tag v1.0.0 && git push --tags) then waits for approval before it deploys." )

Still in the console, once:
  • Firebase: add Firebase to ${PROJECT}; Authentication → Sign-in method: Email/Password and Phone;
    upgrade to Identity Platform and turn on SMS multi-factor; add the dashboard's URL to Authorized domains.
  • Provider secrets when you have them (each: printf %s "<value>" | gcloud secrets versions add <id> --data-file=-),
    then list them in provider_secrets in infra/envs/${ENV}.tfvars and run terraform apply again:
$(terraform -chdir=infra output -json provider_secrets_to_fill | tr -d '{}"' | tr ',' '\n' | sed 's/^/      /')
EOF
