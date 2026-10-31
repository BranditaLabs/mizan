# Azure Monitor alerts and external availability checks. Application-level metrics will be
# configured when Azure Monitor managed Prometheus is deployed beside the API and worker.

resource "azurerm_monitor_action_group" "email" {
  name                = "ag-mizan-${var.env}"
  resource_group_name = azurerm_resource_group.main.name
  # Azure caps action group short names at 12 characters.
  short_name = var.env == "production" ? "mizan-prod" : "mizan-stg"

  dynamic "email_receiver" {
    for_each = toset(var.alert_emails)
    content {
      name                    = "alerts-${substr(sha256(email_receiver.value), 0, 8)}"
      email_address           = email_receiver.value
      use_common_alert_schema = true
    }
  }
}

resource "azurerm_application_insights" "availability" {
  name                = "appi-mizan-${var.env}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  application_type    = "web"
  workspace_id        = azurerm_log_analytics_workspace.main.id
  tags                = local.labels
}

locals {
  # public_url and web_url already fall back to the Container Apps FQDNs until domains are bound.
  api_availability_url = local.public_url
  web_availability_url = local.web_url
}

resource "azurerm_application_insights_standard_web_test" "availability" {
  for_each                = { api = "${local.api_availability_url}/health/ready", web = "${local.web_availability_url}/ar" }
  name                    = "mizan-${var.env}-${each.key}"
  resource_group_name     = azurerm_resource_group.main.name
  location                = azurerm_resource_group.main.location
  application_insights_id = azurerm_application_insights.availability.id
  geo_locations           = ["emea-nl-ams-azr"]
  frequency               = 300
  timeout                 = 30
  enabled                 = true
  request {
    url = each.value
  }
  validation_rules {
    expected_status_code = 200
    ssl_check_enabled    = true
  }
  tags = local.labels
}

resource "azurerm_monitor_metric_alert" "api_5xx" {
  name                = "[${var.env}] API 5xx responses"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [azurerm_container_app.api.id]
  description         = "Any API 5xx response in the evaluation window"
  severity            = 1
  frequency           = "PT1M"
  window_size         = "PT5M"
  criteria {
    metric_namespace = "Microsoft.App/containerApps"
    metric_name      = "Requests"
    aggregation      = "Total"
    operator         = "GreaterThan"
    threshold        = 0
    # StatusCode carries exact codes (500, 503); the 5xx bucket is StatusCodeCategory.
    dimension {
      name     = "StatusCodeCategory"
      operator = "Include"
      values   = ["5xx"]
    }
  }
  action {
    action_group_id = azurerm_monitor_action_group.email.id
  }
}

# One alert per app: Azure Monitor does not support multi-resource metric alerts for Container Apps.
resource "azurerm_monitor_metric_alert" "replica_restarts" {
  for_each = {
    api    = azurerm_container_app.api.id
    worker = azurerm_container_app.worker.id
    web    = azurerm_container_app.web.id
  }
  name                = "[${var.env}] ${each.key} replica restarts"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [each.value]
  description         = "A ${each.key} replica restarted during the evaluation window"
  severity            = 2
  frequency           = "PT1M"
  window_size         = "PT5M"
  criteria {
    metric_namespace = "Microsoft.App/containerApps"
    metric_name      = "RestartCount"
    aggregation      = "Total"
    operator         = "GreaterThan"
    threshold        = 0
  }
  action {
    action_group_id = azurerm_monitor_action_group.email.id
  }
}

resource "azurerm_monitor_metric_alert" "worker_down" {
  name                = "[${var.env}] Worker has no running replica"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [azurerm_container_app.worker.id]
  description         = "The worker must keep at least one replica running"
  severity            = 0
  frequency           = "PT1M"
  window_size         = "PT5M"
  criteria {
    metric_namespace = "Microsoft.App/containerApps"
    metric_name      = "Replicas"
    aggregation      = "Average"
    operator         = "LessThan"
    threshold        = 1
  }
  action {
    action_group_id = azurerm_monitor_action_group.email.id
  }
}

resource "azurerm_monitor_metric_alert" "postgres_cpu" {
  name                = "[${var.env}] PostgreSQL CPU over 80%"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [azurerm_postgresql_flexible_server.main.id]
  description         = "PostgreSQL Flexible Server CPU utilization"
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT15M"
  criteria {
    metric_namespace = "Microsoft.DBforPostgreSQL/flexibleServers"
    metric_name      = "cpu_percent"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }
  action {
    action_group_id = azurerm_monitor_action_group.email.id
  }
}

resource "azurerm_monitor_metric_alert" "postgres_storage" {
  name                = "[${var.env}] PostgreSQL storage over 85%"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [azurerm_postgresql_flexible_server.main.id]
  description         = "PostgreSQL Flexible Server storage utilization"
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT15M"
  criteria {
    metric_namespace = "Microsoft.DBforPostgreSQL/flexibleServers"
    metric_name      = "storage_percent"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 85
  }
  action {
    action_group_id = azurerm_monitor_action_group.email.id
  }
}

resource "azurerm_monitor_metric_alert" "postgres_connections" {
  name                = "[${var.env}] PostgreSQL connections over 160"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [azurerm_postgresql_flexible_server.main.id]
  description         = "Alert before the configured 200-connection limit"
  severity            = 2
  frequency           = "PT1M"
  window_size         = "PT5M"
  criteria {
    metric_namespace = "Microsoft.DBforPostgreSQL/flexibleServers"
    metric_name      = "active_connections"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 160
  }
  action {
    action_group_id = azurerm_monitor_action_group.email.id
  }
}
