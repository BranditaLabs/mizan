output "resource_group" {
  value = azurerm_resource_group.main.name
}

output "acr_name" {
  value = azurerm_container_registry.images.name
}

output "acr_login_server" {
  description = "Push images here: <this>/api:<sha>, <this>/web:<sha>"
  value       = azurerm_container_registry.images.login_server
}

output "api_url" {
  value = local.api_url
}

output "web_url" {
  value = local.dashboard_url
}

output "api_fqdn" {
  value = local.api_fqdn
}

output "web_fqdn" {
  value = local.web_fqdn
}

output "key_vault_name" {
  value = azurerm_key_vault.main.name
}

output "key_vault_key_id" {
  description = "Versionless Key Vault key id for KEY_VAULT_KEY_ID"
  value       = azurerm_key_vault_key.tenant_secrets.versionless_id
}

output "dns_records" {
  description = "Add these at Hostinger, then set bind_custom_domains = true and re-run bootstrap.sh"
  value = {
    for record in flatten([
      for _, domain in local.requested_domains : [
        {
          name  = domain.domain
          value = "CNAME ${domain.domain} ${trimsuffix(domain.app.ingress[0].fqdn, ".")}"
        },
        {
          name  = "asuid.${domain.domain}"
          value = "TXT ${domain.app.custom_domain_verification_id}"
        },
      ]
    ]) : record.name => record.value
  }
}

output "custom_domain_bindings" {
  description = "Hostnames bootstrap.sh binds to their managed certificates (az containerapp hostname bind)"
  value = {
    for key, domain in local.custom_domains : key => {
      hostname    = domain.domain
      app         = domain.app.name
      certificate = azurerm_container_app_environment_managed_certificate.domain[key].id
    }
  }
}

output "container_app_environment" {
  value = azurerm_container_app_environment.main.name
}

output "provider_secrets_to_fill" {
  description = "Create each value in Key Vault, then add its env name to provider_secrets"
  value = {
    for name in ["SHOPIFY_API_SECRET", "META_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "ANTHROPIC_API_KEY", "SENTRY_DSN"] :
    name => "az keyvault secret set --vault-name ${azurerm_key_vault.main.name} --name ${lower(replace(name, "_", "-"))} --value \"$VALUE\""
  }
}

output "shopify_app_urls" {
  description = "Paste into the Shopify app (Dev Dashboard → app → Versions → URLs)"
  value = {
    app_url      = "${local.api_url}/v1/connections/shopify/entry"
    redirect_url = "${local.api_url}/v1/connections/shopify/callback"
  }
}
