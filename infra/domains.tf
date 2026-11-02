# Custom domains attach directly to each Container App. Add DNS records first; the next apply adds
# the hostname to the app and issues a free managed certificate in the environment. Terraform
# cannot set the SNI binding to a managed certificate, so bootstrap.sh then runs
# `az containerapp hostname bind` for each entry of the custom_domain_bindings output (the
# binding fields are ignored below so Terraform does not undo it).

locals {
  requested_domains = merge(
    var.api_domain != "" ? { api = { domain = var.api_domain, app = azurerm_container_app.api } } : {},
    var.web_domain != "" ? { web = { domain = var.web_domain, app = azurerm_container_app.web } } : {},
    var.admin_domain != "" ? { admin = { domain = var.admin_domain, app = azurerm_container_app.admin } } : {},
    # The landing page's host is a second hostname on the web app (MARKETING_HOST, L1-9).
    var.marketing_domain != "" ? { marketing = { domain = var.marketing_domain, app = azurerm_container_app.web } } : {},
  )
  custom_domains = var.bind_custom_domains ? local.requested_domains : {}
  # Hostnames that share an app with one in the first set are added after it: each add rewrites the
  # app's ingress, so two at once on the same app could undo each other.
  first_domains  = { for key, domain in local.custom_domains : key => domain if key != "marketing" }
  second_domains = { for key, domain in local.custom_domains : key => domain if key == "marketing" }
}

resource "azurerm_container_app_custom_domain" "domain" {
  for_each         = local.first_domains
  name             = each.value.domain
  container_app_id = each.value.app.id

  lifecycle {
    ignore_changes = [certificate_binding_type, container_app_environment_certificate_id]
  }
}

resource "azurerm_container_app_custom_domain" "second" {
  for_each         = local.second_domains
  name             = each.value.domain
  container_app_id = each.value.app.id

  lifecycle {
    ignore_changes = [certificate_binding_type, container_app_environment_certificate_id]
  }

  depends_on = [azurerm_container_app_custom_domain.domain]
}

resource "azurerm_container_app_environment_managed_certificate" "domain" {
  for_each                     = local.custom_domains
  name                         = "cert-${each.key}-${var.env}"
  container_app_environment_id = azurerm_container_app_environment.main.id
  subject_name                 = each.value.domain
  domain_control_validation    = "CNAME"

  depends_on = [azurerm_container_app_custom_domain.domain, azurerm_container_app_custom_domain.second]
}
