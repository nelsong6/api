# References to shared infrastructure provisioned by infra-bootstrap.

locals {
  infra = {
    resource_group_name = "infra"
    dns_zone_name       = "romaine.life"
  }

  app_dns_name = "api"
}

data "azurerm_container_app_environment" "infra" {
  name                = "infra-aca"
  resource_group_name = local.infra.resource_group_name
}

data "azurerm_cosmosdb_account" "infra" {
  name                = "infra-cosmos"
  resource_group_name = local.infra.resource_group_name
}

data "azurerm_app_configuration" "infra" {
  name                = "infra-appconfig"
  resource_group_name = local.infra.resource_group_name
}

data "azurerm_key_vault" "main" {
  name                = "romaine-kv"
  resource_group_name = local.infra.resource_group_name
}
