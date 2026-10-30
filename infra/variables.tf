variable "project_id" {
  description = "Google Cloud project, one per environment (mizan-staging, mizan-prod)"
  type        = string
}

variable "env" {
  description = "staging or production"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.env)
    error_message = "env must be staging or production."
  }
}

variable "region" {
  description = "Middle East region: me-central1 (Doha) or me-central2 (Dammam)"
  type        = string
  default     = "me-central1"
}

variable "public_url" {
  description = "Public URL of the API (Cloud Run URL until a domain is mapped)"
  type        = string
  default     = ""
}

variable "web_url" {
  description = "Public URL of the dashboard (CORS)"
  type        = string
  default     = ""
}

variable "admin_url" {
  description = "Public URL of the back office (CORS); empty until it is deployed"
  type        = string
  default     = ""
}

variable "platform_bootstrap_emails" {
  description = "Emails that become the first Mizan staff super admins"
  type        = string
  default     = ""
}

variable "db_tier" {
  description = "Cloud SQL machine tier (set from the H-13 load test for production)"
  type        = string
  default     = "db-custom-1-3840"
}

variable "db_high_availability" {
  description = "Regional (HA) Cloud SQL; on for production"
  type        = bool
  default     = false
}

variable "api_min_instances" {
  type    = number
  default = 0
}

variable "api_max_instances" {
  type    = number
  default = 4
}

variable "worker_min_instances" {
  type    = number
  default = 1
}

variable "provider_secrets" {
  description = <<-EOT
    Provider secrets to hand to the API once a value has been added in Secret Manager
    (gcloud secrets versions add mizan-<name-in-kebab-case> --data-file=-), e.g.
    ["SHOPIFY_API_SECRET", "META_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "ANTHROPIC_API_KEY"].
    A secret is mounted only when listed here, so a deploy never waits on an empty secret.
  EOT
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for s in var.provider_secrets : contains(["SHOPIFY_API_SECRET", "META_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "ANTHROPIC_API_KEY", "SENTRY_DSN"], s)])
    error_message = "Unknown provider secret."
  }
}

variable "api_env" {
  description = "Extra plain (non-secret) environment for the API and worker, e.g. SHOPIFY_API_KEY, BOSTA_TRACKING_URL_TEMPLATE"
  type        = map(string)
  default     = {}
}
