output "container_app_name" {
  value = azurerm_container_app.api.name
}

output "container_app_fqdn" {
  value = azurerm_container_app.api.ingress[0].fqdn
}

output "custom_domain" {
  value = "${local.app_dns_name}.${local.infra.dns_zone_name}"
}
