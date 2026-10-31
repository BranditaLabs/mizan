# Container Apps run API, worker, dashboard, and a manually triggered migration job.

locals {
  api_fqdn = azurerm_container_app.api.ingress[0].fqdn
  web_fqdn = azurerm_container_app.web.ingress[0].fqdn
  # The apps' own FQDNs are <name>.<environment default domain>; computed from the environment so
  # the API's PUBLIC_URL/WEB_URL never reference the app itself. Custom domains are used only once
  # they are bound (bind_custom_domains), so nothing points at a host without DNS or a certificate.
  default_api_url = "https://ca-mizan-api.${azurerm_container_app_environment.main.default_domain}"
  default_web_url = "https://ca-mizan-web.${azurerm_container_app_environment.main.default_domain}"
  public_url = var.public_url != "" ? var.public_url : (
    var.bind_custom_domains && var.api_domain != "" ? "https://${var.api_domain}" : local.default_api_url
  )
  web_url = var.web_url != "" ? var.web_url : (
    var.bind_custom_domains && var.web_domain != "" ? "https://${var.web_domain}" : local.default_web_url
  )
  api_url       = local.public_url
  dashboard_url = local.web_url
  admin_url = var.admin_url != "" ? var.admin_url : (
    var.bind_custom_domains && var.admin_domain != "" ? "https://${var.admin_domain}" : ""
  )
  # First-apply placeholder until CI deploys the real images (image is in ignore_changes). It must
  # answer HTTP 200 on 8080 for /health and /health/ready like the real API, worker and dashboard,
  # and ignore the worker/migration args; traefik/whoami does both (port from WHOAMI_PORT_NUMBER).
  placeholder_image = "docker.io/traefik/whoami:v1.10.1"
  placeholder_env   = { WHOAMI_PORT_NUMBER = "8080" }
  api_plain_env = merge({
    LOG_FORMAT                = "json"
    LOG_LEVEL                 = "info"
    FIREBASE_PROJECT_ID       = var.firebase_project_id
    KEY_VAULT_KEY_ID          = azurerm_key_vault_key.tenant_secrets.versionless_id
    AZURE_CLIENT_ID           = azurerm_user_assigned_identity.api.client_id
    PUBLIC_URL                = local.public_url
    WEB_URL                   = local.web_url
    WORKER_IN_PROCESS         = "false"
    DATABASE_POOL_MAX         = "10"
    FX_SOURCE                 = "open-er-api"
    PLATFORM_BOOTSTRAP_EMAILS = var.platform_bootstrap_emails
    ADMIN_URL                 = local.admin_url
  }, local.placeholder_env, var.api_env)
  api_env = { for key, value in local.api_plain_env : key => value if value != "" }
}

resource "azurerm_container_app" "api" {
  name                         = "ca-mizan-api"
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"
  tags                         = local.labels

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.api.id]
  }

  registry {
    server   = azurerm_container_registry.images.login_server
    identity = azurerm_user_assigned_identity.api.id
  }

  dynamic "secret" {
    for_each = toset(local.api_secret_names)
    content {
      name                = lower(replace(secret.value, "_", "-"))
      key_vault_secret_id = local.key_vault_secret_ids[secret.value]
      identity            = azurerm_user_assigned_identity.api.id
    }
  }

  template {
    min_replicas = var.api_min_instances
    max_replicas = var.api_max_instances
    container {
      name   = "api"
      image  = local.placeholder_image
      cpu    = 1
      memory = "2Gi"

      dynamic "env" {
        for_each = local.api_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = toset(local.api_secret_names)
        content {
          name        = env.value
          secret_name = lower(replace(env.value, "_", "-"))
        }
      }

      startup_probe {
        transport               = "HTTP"
        port                    = 8080
        path                    = "/health/ready"
        interval_seconds        = 3
        failure_count_threshold = 20
      }

      liveness_probe {
        transport               = "HTTP"
        port                    = 8080
        path                    = "/health"
        interval_seconds        = 30
        failure_count_threshold = 3
      }
    }
  }

  ingress {
    external_enabled           = true
    allow_insecure_connections = false
    target_port                = 8080
    transport                  = "http"
    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }

  depends_on = [time_sleep.runtime_rbac]
}

resource "azurerm_container_app" "worker" {
  name                         = "ca-mizan-worker"
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"
  tags                         = local.labels

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.api.id]
  }

  registry {
    server   = azurerm_container_registry.images.login_server
    identity = azurerm_user_assigned_identity.api.id
  }

  dynamic "secret" {
    for_each = toset(local.api_secret_names)
    content {
      name                = lower(replace(secret.value, "_", "-"))
      key_vault_secret_id = local.key_vault_secret_ids[secret.value]
      identity            = azurerm_user_assigned_identity.api.id
    }
  }

  template {
    min_replicas = var.worker_min_instances
    max_replicas = var.worker_max_instances
    container {
      name   = "worker"
      image  = local.placeholder_image
      args   = ["apps/api/dist/worker.js"]
      cpu    = 1
      memory = "2Gi"

      dynamic "env" {
        for_each = local.api_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = toset(local.api_secret_names)
        content {
          name        = env.value
          secret_name = lower(replace(env.value, "_", "-"))
        }
      }

      startup_probe {
        transport               = "HTTP"
        port                    = 8080
        path                    = "/health"
        interval_seconds        = 3
        failure_count_threshold = 20
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }

  depends_on = [time_sleep.runtime_rbac]
}

resource "azurerm_container_app" "web" {
  name                         = "ca-mizan-web"
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  revision_mode                = "Single"
  tags                         = local.labels

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.web.id]
  }

  registry {
    server   = azurerm_container_registry.images.login_server
    identity = azurerm_user_assigned_identity.web.id
  }

  template {
    min_replicas = 0
    max_replicas = 4
    container {
      name   = "web"
      image  = local.placeholder_image
      cpu    = 1
      memory = "1Gi"

      dynamic "env" {
        for_each = local.placeholder_env
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  ingress {
    external_enabled           = true
    allow_insecure_connections = false
    target_port                = 8080
    transport                  = "http"
    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }

  depends_on = [time_sleep.runtime_rbac]
}

resource "azurerm_container_app_job" "migrate" {
  name                         = "caj-mizan-migrate"
  location                     = azurerm_resource_group.main.location
  resource_group_name          = azurerm_resource_group.main.name
  container_app_environment_id = azurerm_container_app_environment.main.id
  replica_timeout_in_seconds   = 900
  replica_retry_limit          = 0
  tags                         = local.labels

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.migrate.id]
  }

  registry {
    server   = azurerm_container_registry.images.login_server
    identity = azurerm_user_assigned_identity.migrate.id
  }

  dynamic "secret" {
    for_each = toset(local.migrate_secret_names)
    content {
      name                = lower(replace(secret.value, "_", "-"))
      key_vault_secret_id = local.key_vault_secret_ids[secret.value]
      identity            = azurerm_user_assigned_identity.migrate.id
    }
  }

  manual_trigger_config {
    parallelism              = 1
    replica_completion_count = 1
  }

  template {
    container {
      name   = "migrate"
      image  = local.placeholder_image
      args   = ["packages/db/dist/cli.js", "migrate"]
      cpu    = 1
      memory = "2Gi"

      env {
        name  = "DATABASE_APP_LOGIN"
        value = "mizan_api"
      }

      dynamic "env" {
        for_each = local.placeholder_env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = toset(local.migrate_secret_names)
        content {
          name        = env.value
          secret_name = lower(replace(env.value, "_", "-"))
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }

  depends_on = [time_sleep.runtime_rbac]
}
