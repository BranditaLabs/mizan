variable "subscription_id" {
  description = "Azure subscription used for this environment"
  type        = string
  default     = ""
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
  description = "Azure region; Mizan's launch region is UAE North"
  type        = string
  default     = "uaenorth"
}

variable "firebase_project_id" {
  description = "Firebase project used for identity (separate from Azure hosting)"
  type        = string
  default     = "mizan-8f906"
}

variable "bind_custom_domains" {
  description = "Bind custom domains after their CNAME and asuid TXT records have been published"
  type        = bool
  default     = false
}

variable "public_url" {
  description = "Public URL of the API (Container Apps FQDN until a custom domain is set)"
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

variable "api_domain" {
  description = "API host, bound directly to its Container App with an Azure managed certificate"
  type        = string
  default     = ""
}

variable "web_domain" {
  description = "Dashboard host, bound directly to its Container App with an Azure managed certificate"
  type        = string
  default     = ""
}

variable "admin_domain" {
  description = "Back-office host; empty until the admin app is deployed"
  type        = string
  default     = ""
}

variable "admin_app" {
  description = "Container App resource name for the back office, once deployed (L0-3)"
  type        = string
  default     = ""
}

variable "platform_bootstrap_emails" {
  description = "Emails that become the first Mizan staff super admins"
  type        = string
  default     = ""
}

variable "db_sku" {
  description = "PostgreSQL Flexible Server SKU (set from the H-13 load test for production)"
  type        = string
  default     = "B_Standard_B1ms"
}

variable "db_high_availability" {
  description = "Zone-redundant PostgreSQL HA; enabled for production"
  type        = bool
  default     = false
}

variable "db_allow_azure_services" {
  description = "Temporary 0.0.0.0 PostgreSQL firewall rule for Azure-hosted services until VNet integration"
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

variable "alert_emails" {
  description = "Who gets alerts by email (an on-call address, not personal ones)"
  type        = list(string)
  default     = []
}

variable "app_metrics_enabled" {
  description = "App-level alerts are deferred until Azure Monitor managed Prometheus is configured"
  type        = bool
  default     = false
}

variable "worker_min_instances" {
  type    = number
  default = 1
}

variable "worker_max_instances" {
  type    = number
  default = 2
}

variable "provider_secrets" {
  description = <<-EOT
    Provider secrets to reference only after the owner has created them in Key Vault
    (az keyvault secret set --vault-name <vault> --name <kebab-case-name> --value <value>).
    A secret is referenced only when listed here, so deployments never wait on an empty secret.
  EOT
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for s in var.provider_secrets : contains(["SHOPIFY_API_SECRET", "META_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "ANTHROPIC_API_KEY", "SENTRY_DSN"], s)])
    error_message = "Unknown provider secret."
  }
}

variable "api_env" {
  description = "Extra plain (non-secret) environment for the API and worker"
  type        = map(string)
  default     = {}
}
