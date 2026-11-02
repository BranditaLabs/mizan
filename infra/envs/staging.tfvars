# terraform -chdir=infra plan -var-file=envs/staging.tfvars -var="subscription_id=<subscription-id>"
env                     = "staging"
region                  = "uaenorth"
firebase_project_id     = "mizan-8f906"
db_sku                  = "B_Standard_B1ms"
db_high_availability    = false
api_min_instances       = 0
api_max_instances       = 4
worker_min_instances    = 1
worker_max_instances    = 2
worker_cpu              = 0.25 # pilot volumes; raise to 0.5/1Gi or 1/2Gi when the outbox lags
worker_memory           = "0.5Gi"
bind_custom_domains     = true
db_allow_azure_services = true # Container Apps reach PostgreSQL without a VNet
# Add these DNS records from `terraform output dns_records` at Hostinger, then set
# bind_custom_domains = true and re-run infra/bootstrap.sh (it applies, then binds the certificates).
api_domain       = "api.mizan.brandita.net"
web_domain       = "app.mizan.brandita.net"
admin_domain     = "admin.mizan.brandita.net" # back office (L0-3)
marketing_domain = "mizan.brandita.net"       # landing page, a second host on the web app (L1-9)
# platform_bootstrap_emails = "you@example.com"
# alert_emails = ["ops@example.com"]
provider_secrets = ["SHOPIFY_API_SECRET"] # values live in Key Vault only; add "META_APP_SECRET" etc. once stored
api_env = {
  SHOPIFY_API_KEY = "3aaaa43e0229a13ae9f56c7198d55d94" # the Shopify app's Client ID (public); its secret is in Key Vault
}
