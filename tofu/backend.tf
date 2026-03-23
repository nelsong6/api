# ============================================================================
# Shared API — Always-On Container App
# ============================================================================
#
# Single backend consolidating all app routes. Runs with min_replicas=1
# to eliminate cold-start latency (~$19/month at 0.25 vCPU / 0.5 Gi).
#
# Managed identity gets access to:
#   1. Cosmos DB Data Contributor (read/write across all app databases)
#   2. App Configuration Data Reader (fetch config at startup)
#   3. Key Vault Secrets User (fetch JWT secret + app secrets)

resource "azurerm_container_app" "api" {
  name                         = "shared-api"
  resource_group_name          = local.infra.resource_group_name
  container_app_environment_id = data.azurerm_container_app_environment.infra.id
  revision_mode                = "Single"

  identity {
    type = "SystemAssigned"
  }

  template {
    container {
      name   = "shared-api"
      image  = "ghcr.io/nelsong6/api/shared-api:latest"
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "PORT"
        value = "3000"
      }

      env {
        name  = "AZURE_APP_CONFIG_ENDPOINT"
        value = data.azurerm_app_configuration.infra.endpoint
      }

      env {
        name  = "KEY_VAULT_URL"
        value = "https://${data.azurerm_key_vault.main.name}.vault.azure.net"
      }
    }

    min_replicas = 1 # Always on — no cold starts
    max_replicas = 3
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }

  ingress {
    external_enabled = true
    target_port      = 3000

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }

    cors {
      allowed_origins = [
        # All app frontends
        "https://workout.romaine.life",
        "https://plants.romaine.life",

        # Development
        "http://localhost:5173",
        "http://localhost:4173",
        "http://localhost:5174"
      ]

      allowed_methods           = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"]
      allowed_headers           = ["*"]
      exposed_headers           = ["*"]
      max_age_in_seconds        = 3600
      allow_credentials_enabled = true
    }
  }
}

# ── Role Assignments ──

resource "azurerm_cosmosdb_sql_role_assignment" "api_cosmos" {
  resource_group_name = local.infra.resource_group_name
  account_name        = data.azurerm_cosmosdb_account.infra.name
  role_definition_id  = "${data.azurerm_cosmosdb_account.infra.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = azurerm_container_app.api.identity[0].principal_id
  scope               = data.azurerm_cosmosdb_account.infra.id
}

resource "azurerm_role_assignment" "api_appconfig_reader" {
  scope                = data.azurerm_app_configuration.infra.id
  role_definition_name = "App Configuration Data Reader"
  principal_id         = azurerm_container_app.api.identity[0].principal_id
}

resource "azurerm_role_assignment" "api_keyvault_reader" {
  scope                = data.azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_container_app.api.identity[0].principal_id
}

# ── Custom Domain (api.romaine.life) ──

resource "azurerm_dns_txt_record" "api_verification" {
  name                = "asuid.${local.app_dns_name}"
  zone_name           = local.infra.dns_zone_name
  resource_group_name = local.infra.resource_group_name
  ttl                 = 3600

  record {
    value = azurerm_container_app.api.custom_domain_verification_id
  }
}

resource "azurerm_dns_cname_record" "api" {
  name                = local.app_dns_name
  zone_name           = local.infra.dns_zone_name
  resource_group_name = local.infra.resource_group_name
  ttl                 = 3600
  record              = azurerm_container_app.api.ingress[0].fqdn
}

resource "azurerm_container_app_custom_domain" "api" {
  name             = "${local.app_dns_name}.${local.infra.dns_zone_name}"
  container_app_id = azurerm_container_app.api.id

  lifecycle {
    ignore_changes = [
      certificate_binding_type,
      container_app_environment_certificate_id
    ]
  }

  depends_on = [
    azurerm_dns_txt_record.api_verification,
    azurerm_dns_cname_record.api
  ]
}
