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
bind_custom_domains     = false
db_allow_azure_services = true # Container Apps reach PostgreSQL without a VNet
# Add these DNS records from `terraform output dns_records` at Hostinger, then set
# bind_custom_domains = true and re-run infra/bootstrap.sh (it applies, then binds the certificates).
api_domain = "api.mizan.brandita.net"
web_domain = "app.mizan.brandita.net"
# admin_domain = "admin.mizan.brandita.net"
# admin_app    = "ca-mizan-admin" # once the back office is deployed (L0-3)
# platform_bootstrap_emails = "you@example.com"
# alert_emails = ["ops@example.com"]
# provider_secrets = ["SHOPIFY_API_SECRET", "META_APP_SECRET"]
