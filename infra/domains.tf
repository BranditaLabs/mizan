# Own domains (L0-4): one global external HTTPS load balancer with a fixed IP and Google-managed
# certificates in front of the Cloud Run services. The DNS stays wherever the domain is (Hostinger
# for brandita.net): add an A record per host to `lb_ip`; certificates turn ACTIVE once the records
# resolve (up to an hour). Cloud Run domain mappings are not used: they are not offered in every
# Middle East region, and a load balancer is where Cloud Armor goes later.
#
# The run.app URLs keep working; PUBLIC_URL and WEB_URL follow the domains once they are set.

locals {
  lb_on = var.api_domain != "" && var.web_domain != ""
  lb_hosts = local.lb_on ? merge(
    { api = { domain = var.api_domain, service = google_cloud_run_v2_service.api.name } },
    { web = { domain = var.web_domain, service = google_cloud_run_v2_service.web.name } },
    var.admin_domain != "" && var.admin_service != "" ? { admin = { domain = var.admin_domain, service = var.admin_service } } : {},
  ) : {}
}

resource "google_project_service" "compute" {
  count              = local.lb_on ? 1 : 0
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

resource "google_compute_global_address" "lb" {
  count      = local.lb_on ? 1 : 0
  name       = "mizan-lb"
  labels     = local.labels
  depends_on = [google_project_service.compute]
}

resource "google_compute_region_network_endpoint_group" "run" {
  for_each              = local.lb_hosts
  name                  = "mizan-${each.key}-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    service = each.value.service
  }
  depends_on = [google_project_service.compute]
}

resource "google_compute_backend_service" "run" {
  for_each              = local.lb_hosts
  name                  = "mizan-${each.key}"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"
  backend {
    group = google_compute_region_network_endpoint_group.run[each.key].id
  }
  log_config {
    enable      = true
    sample_rate = 0.1
  }
}

resource "google_compute_url_map" "https" {
  count           = local.lb_on ? 1 : 0
  name            = "mizan-https"
  default_service = google_compute_backend_service.run["web"].id

  dynamic "host_rule" {
    for_each = local.lb_hosts
    content {
      hosts        = [host_rule.value.domain]
      path_matcher = host_rule.key
    }
  }

  dynamic "path_matcher" {
    for_each = local.lb_hosts
    content {
      name            = path_matcher.key
      default_service = google_compute_backend_service.run[path_matcher.key].id
    }
  }
}

# A new certificate per change of hosts: managed certificates can't be edited in place.
resource "google_compute_managed_ssl_certificate" "lb" {
  count = local.lb_on ? 1 : 0
  name  = "mizan-cert-${substr(sha256(join(",", sort([for h in local.lb_hosts : h.domain]))), 0, 8)}"
  managed {
    domains = sort([for h in local.lb_hosts : h.domain])
  }
  lifecycle {
    create_before_destroy = true
  }
  depends_on = [google_project_service.compute]
}

resource "google_compute_target_https_proxy" "lb" {
  count            = local.lb_on ? 1 : 0
  name             = "mizan-https"
  url_map          = google_compute_url_map.https[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.lb[0].id]
}

resource "google_compute_global_forwarding_rule" "https" {
  count                 = local.lb_on ? 1 : 0
  name                  = "mizan-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.lb[0].id
  port_range            = "443"
  target                = google_compute_target_https_proxy.lb[0].id
  labels                = local.labels
}

# Plain http only redirects to https.
resource "google_compute_url_map" "redirect" {
  count = local.lb_on ? 1 : 0
  name  = "mizan-http-redirect"
  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  count   = local.lb_on ? 1 : 0
  name    = "mizan-http-redirect"
  url_map = google_compute_url_map.redirect[0].id
}

resource "google_compute_global_forwarding_rule" "http" {
  count                 = local.lb_on ? 1 : 0
  name                  = "mizan-http-redirect"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.lb[0].id
  port_range            = "80"
  target                = google_compute_target_http_proxy.redirect[0].id
  labels                = local.labels
}
