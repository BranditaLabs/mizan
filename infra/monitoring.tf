# Monitoring and alerts (E13-2, docs/09 §5). Golden signals from Cloud Run and Cloud SQL's own
# metrics (PromQL over Cloud Monitoring, no agent needed), uptime checks, an error-log rate and a
# dashboard. The app's business alerts (outbox lag, dead letters, open circuits…) read Mizan's
# /metrics through Managed Service for Prometheus: they switch on with app_metrics_enabled once
# the collector runs next to the API and worker.

variable "alert_emails" {
  description = "Who gets alerts by email (an on-call address, not personal ones)"
  type        = list(string)
  default     = []
}

variable "latency_p95_ms" {
  description = "API p95 latency alert threshold, milliseconds"
  type        = number
  default     = 1000
}

variable "app_metrics_enabled" {
  description = "Alert on Mizan's own Prometheus metrics (needs the Managed Prometheus collector on Cloud Run)"
  type        = bool
  default     = false
}

resource "google_monitoring_notification_channel" "email" {
  for_each     = toset(var.alert_emails)
  display_name = "Mizan ${var.env} alerts: ${each.value}"
  type         = "email"
  labels       = { email_address = each.value }
  depends_on   = [google_project_service.enabled]
}

locals {
  channels = [for c in google_monitoring_notification_channel.email : c.id]
  api_host = trimsuffix(replace(local.public_url, "https://", ""), "/")
  web_host = trimsuffix(replace(local.web_url, "https://", ""), "/")
  run      = "monitored_resource=\"cloud_run_revision\""
  sql      = "monitored_resource=\"cloudsql_database\""

  # Golden signals and the database: PromQL over Cloud Monitoring's own metrics.
  system_alerts = {
    api_5xx = {
      name     = "API 5xx rate over 1%"
      query    = "sum(rate(run_googleapis_com:request_count{${local.run},service_name=\"mizan-api\",response_code_class=\"5xx\"}[5m])) / sum(rate(run_googleapis_com:request_count{${local.run},service_name=\"mizan-api\"}[5m])) > 0.01"
      duration = "300s"
      severity = "CRITICAL"
    }
    api_latency = {
      name     = "API p95 latency over ${var.latency_p95_ms} ms"
      query    = "histogram_quantile(0.95, sum by (le) (rate(run_googleapis_com:request_latencies_bucket{${local.run},service_name=\"mizan-api\"}[5m]))) > ${var.latency_p95_ms}"
      duration = "600s"
      severity = "CRITICAL"
    }
    worker_down = {
      name     = "Worker has no running instance"
      query    = "sum(run_googleapis_com:container_instance_count{${local.run},service_name=\"mizan-worker\",state=\"active\"}) < 1 or absent(run_googleapis_com:container_instance_count{${local.run},service_name=\"mizan-worker\",state=\"active\"})"
      duration = "600s"
      severity = "CRITICAL"
    }
    sql_cpu = {
      name     = "Cloud SQL CPU over 80%"
      query    = "max(cloudsql_googleapis_com:database_cpu_utilization{${local.sql}}) > 0.8"
      duration = "900s"
      severity = "WARNING"
    }
    sql_disk = {
      name     = "Cloud SQL disk over 85%"
      query    = "max(cloudsql_googleapis_com:database_disk_utilization{${local.sql}}) > 0.85"
      duration = "900s"
      severity = "WARNING"
    }
    sql_connections = {
      name     = "Cloud SQL connections over 160 of 200"
      query    = "sum(cloudsql_googleapis_com:database_postgresql_num_backends{${local.sql}}) > 160"
      duration = "600s"
      severity = "WARNING"
    }
    error_logs = {
      name     = "More than 10 error logs in 5 minutes"
      query    = "sum(increase(logging_googleapis_com:user_mizan_error_logs[5m])) > 10"
      duration = "0s"
      severity = "WARNING"
    }
  }

  # Mizan's own metrics (docs/09 §5 table), once the collector scrapes /metrics.
  app_alerts = {
    outbox_lag = {
      name     = "Outbox: oldest due job waiting over 10 minutes"
      query    = "max(mizan_outbox_oldest_due_seconds) > 600"
      duration = "300s"
      severity = "CRITICAL"
    }
    dead_letters = {
      name     = "Outbox: more than 20 new dead letters in an hour"
      query    = "max(mizan_outbox_jobs{status=\"dead\"}) - max(mizan_outbox_jobs{status=\"dead\"} offset 1h) > 20"
      duration = "0s"
      severity = "CRITICAL"
    }
    webhook_ack = {
      name     = "Webhook ack p95 over 200 ms"
      query    = "histogram_quantile(0.95, sum by (le) (rate(mizan_http_request_duration_seconds_bucket{route=~\"/webhooks.*\"}[5m]))) > 0.2"
      duration = "600s"
      severity = "CRITICAL"
    }
    webhook_rejections = {
      name     = "Webhook signatures rejected"
      query    = "sum by (provider) (increase(mizan_webhooks_total{status=\"401\"}[15m])) > 0"
      duration = "0s"
      severity = "WARNING"
    }
    event_lag = {
      name     = "Domain events waiting over 2 minutes, or dead"
      query    = "max(mizan_domain_events{state=\"oldest_pending_seconds\"}) > 120 or max(mizan_domain_events{state=\"dead\"}) > 0"
      duration = "600s"
      severity = "WARNING"
    }
    pool = {
      name     = "Database pool has waiting requests"
      query    = "max(mizan_db_pool_connections{state=\"waiting\"}) > 0"
      duration = "300s"
      severity = "WARNING"
    }
    circuit = {
      name     = "A provider circuit is open"
      query    = "max by (provider) (mizan_engine_circuits_open) > 0"
      duration = "300s"
      severity = "WARNING"
    }
    rate_limit = {
      name     = "Rate limiting spike (possible abuse)"
      query    = "sum(rate(mizan_rate_limited_total{policy=\"ip\"}[5m])) > 10"
      duration = "600s"
      severity = "WARNING"
    }
  }
  alerts = merge(local.system_alerts, var.app_metrics_enabled ? local.app_alerts : {})
}

# Error and critical logs from the API and worker (JSON logs carry the level as severity).
resource "google_logging_metric" "errors" {
  name   = "mizan_error_logs"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=~\"^mizan-(api|worker)$\" AND severity>=ERROR"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
  depends_on = [google_project_service.enabled]
}

resource "google_monitoring_alert_policy" "mizan" {
  for_each     = local.alerts
  display_name = "[${var.env}] ${each.value.name}"
  combiner     = "OR"
  severity     = each.value.severity
  conditions {
    display_name = each.value.name
    condition_prometheus_query_language {
      query               = each.value.query
      duration            = each.value.duration
      evaluation_interval = "60s"
    }
  }
  notification_channels = local.channels
  alert_strategy {
    auto_close = "1800s"
  }
  documentation {
    content   = "Runbooks: docs/runbooks/ in the repository. Dashboard: Monitoring → Dashboards → Mizan ${var.env}."
    mime_type = "text/markdown"
  }
  depends_on = [google_logging_metric.errors]
}

# Uptime: the API's readiness (database reachable) and the dashboard's Arabic home, from outside.
resource "google_monitoring_uptime_check_config" "site" {
  for_each     = { api = { host = local.api_host, path = "/health/ready" }, web = { host = local.web_host, path = "/ar" } }
  display_name = "mizan-${var.env}-${each.key}"
  timeout      = "10s"
  period       = "60s"
  http_check {
    path         = each.value.path
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }
  monitored_resource {
    type   = "uptime_url"
    labels = { project_id = var.project_id, host = each.value.host }
  }
  depends_on = [google_project_service.enabled]
}

resource "google_monitoring_alert_policy" "uptime" {
  for_each     = google_monitoring_uptime_check_config.site
  display_name = "[${var.env}] ${each.key} is down"
  combiner     = "OR"
  severity     = "CRITICAL"
  conditions {
    display_name = "${each.key} uptime check failing"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${each.value.uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "120s"
      aggregations {
        alignment_period     = "1200s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.*"]
      }
    }
  }
  notification_channels = local.channels
}

resource "google_monitoring_dashboard" "mizan" {
  dashboard_json = jsonencode({
    displayName = "Mizan ${var.env}"
    mosaicLayout = {
      columns = 12
      tiles = [for i, w in [
        { title = "API requests by status class", query = "sum by (response_code_class) (rate(run_googleapis_com:request_count{${local.run},service_name=\"mizan-api\"}[5m]))" },
        { title = "API p95 latency (ms)", query = "histogram_quantile(0.95, sum by (le) (rate(run_googleapis_com:request_latencies_bucket{${local.run},service_name=\"mizan-api\"}[5m])))" },
        { title = "Instances (API, worker, web)", query = "sum by (service_name) (run_googleapis_com:container_instance_count{${local.run},state=\"active\"})" },
        { title = "Error logs per 5 min", query = "sum(increase(logging_googleapis_com:user_mizan_error_logs[5m]))" },
        { title = "Cloud SQL CPU", query = "max(cloudsql_googleapis_com:database_cpu_utilization{${local.sql}})" },
        { title = "Cloud SQL connections", query = "sum(cloudsql_googleapis_com:database_postgresql_num_backends{${local.sql}})" },
        ] : {
        xPos   = (i % 2) * 6
        yPos   = floor(i / 2) * 4
        width  = 6
        height = 4
        widget = {
          title = w.title
          xyChart = {
            dataSets = [{ timeSeriesQuery = { prometheusQuery = w.query }, plotType = "LINE" }]
          }
        }
      }]
    }
  })
  depends_on = [google_project_service.enabled]
}
