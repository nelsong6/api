# Shared API JWT signing secret — one secret for all apps behind this gateway.
resource "random_password" "jwt_signing_secret" {
  length  = 64
  special = false
}

resource "azurerm_key_vault_secret" "jwt_signing_secret" {
  name         = "api-jwt-signing-secret"
  value        = random_password.jwt_signing_secret.result
  key_vault_id = data.azurerm_key_vault.main.id
}
