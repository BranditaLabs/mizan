# Production is deployed only from v* release tags after GitHub environment approval.
env                  = "production"
region               = "uaenorth"
firebase_project_id  = "mizan-8f906"
db_sku               = "GP_Standard_D2s_v3" # set from the H-13 load test
db_high_availability = true
api_min_instances    = 2
api_max_instances    = 10
worker_min_instances = 1
worker_max_instances = 2
bind_custom_domains  = false
# Temporary until VNet integration/private access (a Terraform check warns while it is on).
db_allow_azure_services = true
# Set the production domains and publish their CNAME + asuid TXT records before enabling binding;
# then re-run infra/bootstrap.sh, which applies and binds the managed certificates.
# api_domain   = "api.mizan.example"
# web_domain   = "app.mizan.example"
# admin_domain = "admin.mizan.example"
# admin_app    = "ca-mizan-admin"
# platform_bootstrap_emails = "you@example.com"
# alert_emails = ["oncall@example.com"]
# provider_secrets = ["SHOPIFY_API_SECRET", "META_APP_SECRET"]
