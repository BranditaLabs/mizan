terraform {
  required_version = ">= 1.9.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  # State in the bucket infra/bootstrap.sh creates: terraform init -backend-config="bucket=<project>-tfstate"
  backend "gcs" {
    prefix = "mizan"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
