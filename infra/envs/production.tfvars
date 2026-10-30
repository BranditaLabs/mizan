# Production (E13-1). One project per market:
#   Egypt and the region:  bash infra/bootstrap.sh <prod-project> me-central1 production
#   Saudi stores (in-Kingdom data): bash infra/bootstrap.sh <ksa-project> me-central2 production
env                  = "production"
region               = "me-central1"
db_tier              = "db-custom-2-7680" # set from the H-13 load test
db_high_availability = true
api_min_instances    = 2
api_max_instances    = 10
worker_min_instances = 1
latency_p95_ms       = 300 # docs/09 §5: API p95 target
# alert_emails = ["oncall@example.com"]
# After domains are mapped:
# public_url = "https://api.mizan.example"
# web_url    = "https://app.mizan.example"
