# terraform -chdir=infra plan -var-file=envs/staging.tfvars -var="project_id=<your staging project id>"
env                  = "staging"
region               = "me-central1"
db_tier              = "db-custom-1-3840"
db_high_availability = false
api_min_instances    = 0
api_max_instances    = 4
worker_min_instances = 1
# After the first apply, set these to the Cloud Run URLs from `terraform output` (or the mapped domains):
# public_url = "https://api-xxxxx-ww.a.run.app"
# web_url    = "https://web-xxxxx-ww.a.run.app"
# platform_bootstrap_emails = "you@example.com"
# Alerts by email (an on-call or team address):
# alert_emails = ["ops@example.com"]
