# Remote state in Azure Storage (backend config passed via -backend-config in CI).
# OIDC auth for Azure and Azure AD providers — no static credentials stored.

terraform {
  backend "azurerm" {}

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
  use_oidc = true
}
