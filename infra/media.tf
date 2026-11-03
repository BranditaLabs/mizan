# P3: product pictures uploaded to Mizan. A private container: the API writes and reads it with its
# managed identity and serves the pictures itself at /media/<tenant>/<key> (public, cached a year),
# so no blob is ever public and no account key or SAS exists.

resource "azurerm_storage_account" "media" {
  name                            = "mizan${var.env}${random_string.suffix.result}m"
  resource_group_name             = azurerm_resource_group.main.name
  location                        = azurerm_resource_group.main.location
  account_tier                    = "Standard"
  account_replication_type        = var.env == "production" ? "ZRS" : "LRS"
  account_kind                    = "StorageV2"
  min_tls_version                 = "TLS1_2"
  https_traffic_only_enabled      = true
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = false
  default_to_oauth_authentication = true
  tags                            = local.labels

  blob_properties {
    versioning_enabled = false
    delete_retention_policy {
      days = 7
    }
  }
}

resource "azurerm_storage_container" "media" {
  name                  = "media"
  storage_account_id    = azurerm_storage_account.media.id
  container_access_type = "private"
}

# The API (and the worker, which shares its identity) writes and reads pictures; nothing else.
resource "azurerm_role_assignment" "api_media" {
  scope                = azurerm_storage_account.media.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.api.principal_id
  principal_type       = "ServicePrincipal"
}
