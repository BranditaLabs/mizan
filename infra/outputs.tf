output "api_url" {
  value = google_cloud_run_v2_service.api.uri
}

output "web_url" {
  value = google_cloud_run_v2_service.web.uri
}

output "artifact_registry" {
  description = "Push images here: <this>/api:<sha>, <this>/web:<sha>"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "cloud_sql_instance" {
  value = google_sql_database_instance.main.connection_name
}

output "kms_key_name" {
  value = google_kms_crypto_key.secrets.id
}

output "provider_secrets_to_fill" {
  description = "Add a value with: printf %s \"$VALUE\" | gcloud secrets versions add <id> --data-file=- ; then list its env name in provider_secrets"
  value       = { for k, s in google_secret_manager_secret.provider : k => s.secret_id }
}
