# Cloud Run: api, worker, web, and the migrate job. Deterministic URLs
# (https://<service>-<project number>.<region>.run.app) let PUBLIC_URL and WEB_URL be known before
# the first deploy. With api_domain and web_domain set (domains.tf) the URLs follow the domains;
# public_url / web_url still override both.

locals {
  project_number = data.google_project.this.number
  run_url        = { for s in ["mizan-api", "mizan-web"] : s => "https://${s}-${local.project_number}.${var.region}.run.app" }
  public_url     = var.public_url != "" ? var.public_url : var.api_domain != "" ? "https://${var.api_domain}" : local.run_url["mizan-api"]
  web_url        = var.web_url != "" ? var.web_url : var.web_domain != "" ? "https://${var.web_domain}" : local.run_url["mizan-web"]
  api_plain_env = merge({
    LOG_FORMAT                = "json"
    LOG_LEVEL                 = "info"
    FIREBASE_PROJECT_ID       = var.project_id
    KMS_KEY_NAME              = google_kms_crypto_key.secrets.id
    PUBLIC_URL                = local.public_url
    WEB_URL                   = local.web_url
    WORKER_IN_PROCESS         = "false"
    DATABASE_POOL_MAX         = "10"
    FX_SOURCE                 = "open-er-api"
    PLATFORM_BOOTSTRAP_EMAILS = var.platform_bootstrap_emails
    ADMIN_URL                 = var.admin_url != "" ? var.admin_url : var.admin_domain != "" ? "https://${var.admin_domain}" : ""
  }, var.api_env)
  # Empty values are left out: the API validates every variable it is given.
  api_env         = { for k, v in local.api_plain_env : k => v if v != "" }
  api_secrets_all = concat(local.api_secrets, var.provider_secrets)
  deletable       = var.env != "production"
  secret_ids = merge(
    { for k, sec in google_secret_manager_secret.generated : k => sec.secret_id },
    { for k, sec in google_secret_manager_secret.provider : k => sec.secret_id },
  )
}

resource "google_cloud_run_v2_service" "api" {
  name                = "mizan-api"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = !local.deletable
  labels              = local.labels
  template {
    service_account                  = google_service_account.api.email
    max_instance_request_concurrency = 80
    timeout                          = "60s"
    scaling {
      min_instance_count = var.api_min_instances
      max_instance_count = var.api_max_instances
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }
    containers {
      image = local.placeholder
      ports {
        container_port = 8080
      }
      resources {
        limits   = { cpu = "1", memory = "1Gi" }
        cpu_idle = true
      }
      dynamic "env" {
        for_each = local.api_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = toset(local.api_secrets_all)
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = local.secret_ids[env.value]
              version = "latest"
            }
          }
        }
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
      startup_probe {
        http_get {
          path = "/health/ready"
        }
        period_seconds    = 3
        failure_threshold = 20
      }
      liveness_probe {
        http_get {
          path = "/health"
        }
        period_seconds = 30
      }
    }
  }
  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
  depends_on = [google_secret_manager_secret_iam_member.api, google_secret_manager_secret_version.generated]
}

resource "google_cloud_run_v2_service" "worker" {
  name                = "mizan-worker"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = !local.deletable
  labels              = local.labels
  template {
    service_account = google_service_account.api.email
    scaling {
      min_instance_count = var.worker_min_instances
      max_instance_count = 2
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }
    containers {
      image = local.placeholder
      args  = ["apps/api/dist/worker.js"]
      ports {
        container_port = 8080
      }
      resources {
        limits   = { cpu = "1", memory = "1Gi" }
        cpu_idle = false # the outbox and the event dispatcher run between requests
      }
      dynamic "env" {
        for_each = local.api_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = toset(local.api_secrets_all)
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = local.secret_ids[env.value]
              version = "latest"
            }
          }
        }
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
      startup_probe {
        http_get {
          path = "/health"
        }
        period_seconds    = 3
        failure_threshold = 20
      }
    }
  }
  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
  depends_on = [google_secret_manager_secret_iam_member.api, google_secret_manager_secret_version.generated]
}

resource "google_cloud_run_v2_service" "web" {
  name                = "mizan-web"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = !local.deletable
  labels              = local.labels
  template {
    service_account                  = google_service_account.web.email
    max_instance_request_concurrency = 80
    scaling {
      min_instance_count = 0
      max_instance_count = 4
    }
    containers {
      image = local.placeholder
      ports {
        container_port = 8080
      }
      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }
    }
  }
  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
  depends_on = [google_project_service.enabled]
}

# The API and the dashboard are public (the API authenticates every /v1 call itself).
resource "google_cloud_run_v2_service_iam_member" "public" {
  for_each = { api = google_cloud_run_v2_service.api.name, web = google_cloud_run_v2_service.web.name }
  location = var.region
  name     = each.value
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Migrations before every deploy: the schema owner applies them, then keeps the API's login.
resource "google_cloud_run_v2_job" "migrate" {
  name                = "mizan-migrate"
  location            = var.region
  deletion_protection = !local.deletable
  labels              = local.labels
  template {
    task_count = 1
    template {
      service_account = google_service_account.migrate.email
      max_retries     = 0
      timeout         = "900s"
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.main.connection_name]
        }
      }
      containers {
        image = local.placeholder
        args  = ["packages/db/dist/cli.js", "migrate"]
        env {
          name  = "DATABASE_APP_LOGIN"
          value = "mizan_api"
        }
        dynamic "env" {
          for_each = toset(local.migrate_secrets)
          content {
            name = env.value
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.generated[env.value].secret_id
                version = "latest"
              }
            }
          }
        }
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
    }
  }
  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }
  depends_on = [google_secret_manager_secret_iam_member.migrate, google_secret_manager_secret_version.generated, google_sql_user.migrator]
}
