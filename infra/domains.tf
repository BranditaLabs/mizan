# Custom domains attach directly to each Container App. Add DNS records first; the next apply adds
# the hostname to the app and issues a free managed certificate in the environment. Terraform
# cannot set the SNI binding to a managed certificate, so bootstrap.sh then runs
# `az containerapp hostname bind` for each entry of the custom_domain_bindings output (the
# binding fields are ignored below so Terraform does not undo it).

locals {
  requested_domains = merge(
    var.api_domain != "" ? { api = { domain = var.api_domain, app = azurerm_container_app.api } } : {},
    var.web_domain != "" ? { web = { domain = var.web_domain, app = azurerm_container_app.web } } : {},
    var.admin_domain != "" && var.admin_app != "" ? {
      admin = {
        domain = var.admin_domain
        app    = data.azurerm_container_app.admin[0]
      }
    } : {},
  )
  custom_domains = var.bind_custom_domains ? local.requested_domains : {}
}

data "azurerm_container_app" "admin" {
  count               = var.admin_domain != "" && var.admin_app != "" ? 1 : 0
  name                = var.admin_app
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_container_app_custom_domain" "domain" {
  for_each         = local.custom_domains
  name             = each.value.domain
  container_app_id = each.value.app.id

  lifecycle {
    ignore_changes = [certificate_binding_type, container_app_environment_certificate_id]
  }
}

resource "azurerm_container_app_environment_managed_certificate" "domain" {
  for_each                     = local.custom_domains
  name                         = "cert-${each.key}-${var.env}"
  container_app_environment_id = azurerm_container_app_environment.main.id
  subject_name                 = each.value.domain
  domain_control_validation    = "CNAME"

  depends_on = [azurerm_container_app_custom_domain.domain]
}
