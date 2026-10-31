# Azure resources for one environment. Container Apps start on a placeholder image; CI owns
# image releases. Runtime identities are separate from the GitHub deploy identity.

locals {
  name   = "mizan"
  labels = { app = "mizan", env = var.env }
}

resource "random_string" "suffix" {
  length  = 5
  lower   = true
  upper   = false
  numeric = true
  special = false
}

resource "azurerm_resource_group" "main" {
  name     = "rg-mizan-${var.env}"
  location = var.region
  tags     = local.labels
}

resource "azurerm_log_analytics_workspace" "main" {
  name                = "law-mizan-${var.env}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.labels
}

resource "azurerm_container_app_environment" "main" {
  name                       = "cae-mizan-${var.env}"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  tags                       = local.labels
}

resource "azurerm_container_registry" "images" {
  name                = "mizan${var.env}${random_string.suffix.result}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Basic"
  admin_enabled       = false
  tags                = local.labels
}

resource "azurerm_user_assigned_identity" "api" {
  name                = "id-mizan-api"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.labels
}

resource "azurerm_user_assigned_identity" "web" {
  name                = "id-mizan-web"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.labels
}

resource "azurerm_user_assigned_identity" "migrate" {
  name                = "id-mizan-migrate"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.labels
}

resource "azurerm_role_assignment" "acr_pull" {
  for_each = {
    api     = azurerm_user_assigned_identity.api.principal_id
    web     = azurerm_user_assigned_identity.web.principal_id
    migrate = azurerm_user_assigned_identity.migrate.principal_id
  }
  scope                = azurerm_container_registry.images.id
  role_definition_name = "AcrPull"
  principal_id         = each.value
  principal_type       = "ServicePrincipal"
}

resource "azurerm_key_vault" "main" {
  name                       = "mizan${var.env}${random_string.suffix.result}"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  rbac_authorization_enabled = true
  purge_protection_enabled   = true
  soft_delete_retention_days = 90
  # Public endpoint on purpose: Consumption Container Apps without a VNet have no stable egress
  # IPs, so access is Entra RBAC only. Move to a private endpoint with the production VNet.
  public_network_access_enabled = true
  tags                          = local.labels

  network_acls {
    default_action = "Allow"
    bypass         = "AzureServices"
  }
}

data "azurerm_client_config" "current" {}

resource "azurerm_key_vault_key" "tenant_secrets" {
  name         = "tenant-secrets"
  key_vault_id = azurerm_key_vault.main.id
  key_type     = "RSA"
  key_size     = 3072
  key_opts     = ["encrypt", "decrypt", "wrapKey", "unwrapKey"]

  depends_on = [time_sleep.key_vault_rbac]

  lifecycle {
    prevent_destroy = true
  }
}

resource "azurerm_role_assignment" "api_crypto" {
  scope                = "${azurerm_key_vault.main.id}/keys/tenant-secrets"
  role_definition_name = "Key Vault Crypto User"
  principal_id         = azurerm_user_assigned_identity.api.principal_id
  principal_type       = "ServicePrincipal"
  depends_on           = [azurerm_key_vault_key.tenant_secrets]
}

# PostgreSQL Flexible Server. The 0.0.0.0 "Azure services" firewall rule is an explicit per-env
# opt-in (db_allow_azure_services); production must move to VNet integration/private access and
# turn it off before launch (a check warns while it is on in production).
resource "random_password" "migrator" {
  length  = 40
  special = false
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

resource "azurerm_postgresql_flexible_server" "main" {
  name                          = "mizan-${var.env}-${random_string.suffix.result}-pg"
  resource_group_name           = azurerm_resource_group.main.name
  location                      = azurerm_resource_group.main.location
  version                       = "16"
  administrator_login           = "mizan_migrator"
  administrator_password        = random_password.migrator.result
  zone                          = "1"
  sku_name                      = var.db_sku
  storage_mb                    = 32768
  storage_tier                  = "P4"
  backup_retention_days         = 14
  geo_redundant_backup_enabled  = false
  public_network_access_enabled = true
  tags                          = local.labels

  dynamic "high_availability" {
    for_each = var.db_high_availability ? [1] : []
    content {
      mode                      = "ZoneRedundant"
      standby_availability_zone = "2"
    }
  }

  # After an HA failover Azure swaps the primary and standby zones; do not fight it.
  lifecycle {
    ignore_changes = [zone, high_availability[0].standby_availability_zone]
  }
}

resource "azurerm_postgresql_flexible_server_database" "mizan" {
  name      = local.name
  server_id = azurerm_postgresql_flexible_server.main.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

resource "azurerm_postgresql_flexible_server_firewall_rule" "azure_services" {
  count            = var.db_allow_azure_services ? 1 : 0
  name             = "allow-azure-services"
  server_id        = azurerm_postgresql_flexible_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

check "production_database_network" {
  assert {
    condition     = !(var.env == "production" && var.db_allow_azure_services)
    error_message = "Production PostgreSQL still allows all Azure services (0.0.0.0). Move to VNet integration/private access and set db_allow_azure_services = false before launch."
  }
}

resource "azurerm_postgresql_flexible_server_configuration" "secure_transport" {
  name      = "require_secure_transport"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = "on"
}

resource "azurerm_postgresql_flexible_server_configuration" "max_connections" {
  name      = "max_connections"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = "200"
}

locals {
  generated_secrets = {
    DATABASE_URL          = "postgres://mizan_api:${random_password.app.result}@${azurerm_postgresql_flexible_server.main.fqdn}:5432/mizan?sslmode=require"
    DATABASE_URL_MIGRATOR = "postgres://mizan_migrator:${random_password.migrator.result}@${azurerm_postgresql_flexible_server.main.fqdn}:5432/mizan?sslmode=require"
    DATABASE_APP_PASSWORD = random_password.app.result
    LINK_SIGNING_KEY      = random_id.link_signing_key.b64_std
    METRICS_TOKEN         = random_password.metrics_token.result
  }
}

resource "azurerm_key_vault_secret" "generated" {
  for_each     = local.generated_secrets
  name         = lower(replace(each.key, "_", "-"))
  value        = each.value
  key_vault_id = azurerm_key_vault.main.id
  content_type = "Mizan generated application secret"

  depends_on = [time_sleep.key_vault_rbac]
}

resource "azurerm_role_assignment" "current_key_vault_secrets" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
  principal_type       = "User"
}

resource "azurerm_role_assignment" "current_key_vault_crypto" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Crypto Officer"
  principal_id         = data.azurerm_client_config.current.object_id
  principal_type       = "User"
}

locals {
  key_vault_secret_ids = merge(
    { for key, secret in azurerm_key_vault_secret.generated : key => secret.versionless_id },
    {
      for key in var.provider_secrets :
      key => "${azurerm_key_vault.main.vault_uri}secrets/${lower(replace(key, "_", "-"))}"
    },
  )
  api_secret_names     = concat(["DATABASE_URL", "LINK_SIGNING_KEY", "METRICS_TOKEN"], var.provider_secrets)
  migrate_secret_names = ["DATABASE_URL_MIGRATOR", "DATABASE_APP_PASSWORD"]
}

resource "azurerm_role_assignment" "api_secrets" {
  for_each             = toset(local.api_secret_names)
  scope                = "${azurerm_key_vault.main.id}/secrets/${lower(replace(each.value, "_", "-"))}"
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.api.principal_id
  principal_type       = "ServicePrincipal"
  depends_on           = [azurerm_key_vault_secret.generated]
}

resource "azurerm_role_assignment" "migrate_secrets" {
  for_each             = toset(local.migrate_secret_names)
  scope                = "${azurerm_key_vault.main.id}/secrets/${lower(replace(each.value, "_", "-"))}"
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.migrate.principal_id
  principal_type       = "ServicePrincipal"
  depends_on           = [azurerm_key_vault_secret.generated]
}

# Azure RBAC data-plane grants take minutes to propagate; depends_on only orders the calls.
# Wait before Terraform writes the key and secrets with its own fresh grants.
resource "time_sleep" "key_vault_rbac" {
  create_duration = "120s"
  triggers = {
    secrets = azurerm_role_assignment.current_key_vault_secrets.id
    crypto  = azurerm_role_assignment.current_key_vault_crypto.id
  }
}

# Same for the runtime identities: Container Apps resolve Key Vault references and pull from ACR
# when a revision is created. New grants (e.g. a provider secret) re-run the wait.
resource "time_sleep" "runtime_rbac" {
  create_duration = "120s"
  triggers = {
    grants = join(",", sort(concat(
      [for assignment in azurerm_role_assignment.api_secrets : assignment.id],
      [for assignment in azurerm_role_assignment.migrate_secrets : assignment.id],
      [for assignment in azurerm_role_assignment.acr_pull : assignment.id],
      [azurerm_role_assignment.api_crypto.id],
    )))
  }
}
