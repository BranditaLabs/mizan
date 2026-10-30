# Mizan on Google Cloud (E1-11, docs/09). One project per environment, Middle East region.
# Cloud Run runs the API, the worker and the dashboard from images CI pushes to Artifact
# Registry; a Cloud Run job runs migrations as the schema owner and keeps the API's login (RLS
# roles only). Images are deployed by .github/workflows/deploy-staging.yml, so Terraform starts
# each service on a placeholder image and ignores the image afterwards.

locals {
  name        = "mizan"
  labels      = { app = "mizan", env = var.env }
  placeholder = "us-docker.pkg.dev/cloudrun/container/hello"
  services = [
    "run.googleapis.com", "sqladmin.googleapis.com", "secretmanager.googleapis.com", "cloudkms.googleapis.com",
    "artifactregistry.googleapis.com", "storage.googleapis.com", "iam.googleapis.com", "logging.googleapis.com",
    "monitoring.googleapis.com", "cloudtrace.googleapis.com", "identitytoolkit.googleapis.com",
  ]
}

data "google_project" "this" {}

resource "google_project_service" "enabled" {
  for_each           = toset(local.services)
  service            = each.value
  disable_on_destroy = false
}

# ───────────── Images ─────────────

resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = local.name
  format        = "DOCKER"
  description   = "Mizan images (api: API, worker and migrations; web: dashboard)"
  labels        = local.labels
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 20
    }
  }
  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "2592000s" # 30 days
    }
  }
  depends_on = [google_project_service.enabled]
}

# ───────────── Identities (least privilege) ─────────────

resource "google_service_account" "api" {
  account_id   = "mizan-api"
  display_name = "Mizan API and worker"
}

resource "google_service_account" "web" {
  account_id   = "mizan-web"
  display_name = "Mizan dashboard (serves pages only)"
}

resource "google_service_account" "migrate" {
  account_id   = "mizan-migrate"
  display_name = "Mizan migrations (schema owner)"
}

resource "google_project_iam_member" "api" {
  for_each = toset(["roles/cloudsql.client", "roles/logging.logWriter", "roles/monitoring.metricWriter", "roles/cloudtrace.agent"])
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "migrate" {
  for_each = toset(["roles/cloudsql.client", "roles/logging.logWriter"])
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.migrate.email}"
}

resource "google_project_iam_member" "web" {
  for_each = toset(["roles/logging.logWriter", "roles/monitoring.metricWriter"])
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.web.email}"
}

# ───────────── Cloud KMS: wraps the per-secret data keys of merchant credentials ─────────────

resource "google_kms_key_ring" "mizan" {
  name       = "${local.name}-${var.env}"
  location   = var.region
  depends_on = [google_project_service.enabled]
}

resource "google_kms_crypto_key" "secrets" {
  name            = "tenant-secrets"
  key_ring        = google_kms_key_ring.mizan.id
  rotation_period = "7776000s" # 90 days; old versions keep decrypting
  labels          = local.labels
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key_iam_member" "api" {
  crypto_key_id = google_kms_crypto_key.secrets.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.api.email}"
}

# ───────────── Files: labels, exports, settlement uploads (signed URLs) ─────────────

resource "google_storage_bucket" "files" {
  name                        = "${var.project_id}-files"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  labels                      = local.labels
  lifecycle_rule {
    condition {
      age = 180
    }
    action {
      type = "Delete"
    }
  }
  depends_on = [google_project_service.enabled]
}

resource "google_storage_bucket_iam_member" "api_files" {
  bucket = google_storage_bucket.files.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api.email}"
}

# ───────────── Database: Cloud SQL PostgreSQL 16 ─────────────
# Reached only through the Cloud SQL connector (Cloud Run's /cloudsql socket, IAM checked): no
# authorized networks. Production moves to private IP with HA (docs/09 §2).

resource "google_sql_database_instance" "main" {
  name                = "${local.name}-${var.env}"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = true
  settings {
    tier              = var.db_tier
    edition           = "ENTERPRISE"
    availability_type = var.db_high_availability ? "REGIONAL" : "ZONAL"
    disk_autoresize   = true
    user_labels       = local.labels
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "00:00" # 02:00–03:00 Cairo
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 14
      }
    }
    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }
    database_flags {
      name  = "max_connections"
      value = "200"
    }
    insights_config {
      query_insights_enabled  = true
      record_application_tags = false
      record_client_address   = false
    }
    maintenance_window {
      day  = 5 # Friday
      hour = 1
    }
  }
  depends_on = [google_project_service.enabled]
}

resource "google_sql_database" "mizan" {
  name     = local.name
  instance = google_sql_database_instance.main.name
}

# The schema owner (migrations). The API's own login is made by the migration job, not here:
# users made through the Cloud SQL API join cloudsqlsuperuser.
resource "random_password" "migrator" {
  length  = 40
  special = false
}

resource "google_sql_user" "migrator" {
  name     = "mizan_migrator"
  instance = google_sql_database_instance.main.name
  password = random_password.migrator.result
}

resource "random_password" "app" {
  length  = 40
  special = false
}

resource "random_id" "link_signing_key" {
  byte_length = 32
}

resource "random_password" "metrics_token" {
  length  = 40
  special = false
}

locals {
  socket = "/cloudsql/${google_sql_database_instance.main.connection_name}"
  generated = {
    DATABASE_URL          = "postgres://mizan_api:${random_password.app.result}@localhost/${local.name}?host=${local.socket}"
    DATABASE_URL_MIGRATOR = "postgres://mizan_migrator:${random_password.migrator.result}@localhost/${local.name}?host=${local.socket}"
    DATABASE_APP_PASSWORD = random_password.app.result
    LINK_SIGNING_KEY      = random_id.link_signing_key.b64_std
    METRICS_TOKEN         = random_password.metrics_token.result
  }
}

# ───────────── Secrets ─────────────
# Generated ones get their value here (kept in the encrypted state bucket); provider secrets are
# empty containers the owner fills: gcloud secrets versions add mizan-shopify-api-secret --data-file=-

resource "google_secret_manager_secret" "generated" {
  for_each  = local.generated
  secret_id = "mizan-${lower(replace(each.key, "_", "-"))}"
  labels    = local.labels
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_version" "generated" {
  for_each    = local.generated
  secret      = google_secret_manager_secret.generated[each.key].id
  secret_data = each.value
}

resource "google_secret_manager_secret" "provider" {
  for_each  = toset(["SHOPIFY_API_SECRET", "META_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "ANTHROPIC_API_KEY", "SENTRY_DSN"])
  secret_id = "mizan-${lower(replace(each.key, "_", "-"))}"
  labels    = local.labels
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  depends_on = [google_project_service.enabled]
}

locals {
  api_secrets     = ["DATABASE_URL", "LINK_SIGNING_KEY", "METRICS_TOKEN"]
  migrate_secrets = ["DATABASE_URL_MIGRATOR", "DATABASE_APP_PASSWORD"]
}

resource "google_secret_manager_secret_iam_member" "api" {
  for_each  = toset(local.api_secrets)
  secret_id = google_secret_manager_secret.generated[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "api_provider" {
  for_each  = google_secret_manager_secret.provider
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "migrate" {
  for_each  = toset(local.migrate_secrets)
  secret_id = google_secret_manager_secret.generated[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.migrate.email}"
}
