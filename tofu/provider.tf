# Remote state in Azure Storage (backend config passed via -backend-config in CI).
# OIDC auth for Azure and Azure AD providers — no static credentials stored.
# required_providers is injected via shared_providers.tf from infra-bootstrap.

terraform {
  backend "azurerm" {}
}

provider "azurerm" {
  features {}
  use_oidc = true
}

provider "random" {}
