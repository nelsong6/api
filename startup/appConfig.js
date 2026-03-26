import { AppConfigurationClient } from '@azure/app-configuration';
import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';

/**
 * Fetches application configuration for all apps from Azure App Configuration
 * and Key Vault.
 *
 * Environment variables consumed:
 *   AZURE_APP_CONFIG_ENDPOINT  – App Configuration endpoint URL
 *   KEY_VAULT_URL              – Key Vault endpoint URL
 */
export async function fetchAppConfig() {
  const appConfigEndpoint = process.env.AZURE_APP_CONFIG_ENDPOINT;
  if (!appConfigEndpoint) {
    throw new Error('AZURE_APP_CONFIG_ENDPOINT environment variable is not set.');
  }

  const keyVaultUrl = process.env.KEY_VAULT_URL;
  if (!keyVaultUrl) {
    throw new Error('KEY_VAULT_URL environment variable is not set.');
  }

  const credential = new DefaultAzureCredential();
  const appConfigClient = new AppConfigurationClient(appConfigEndpoint, credential);
  const kvClient = new SecretClient(keyVaultUrl, credential);

  // Shared config
  const cosmosEndpointSetting = await appConfigClient.getConfigurationSetting({
    key: 'cosmos_db_endpoint',
  });

  const microsoftClientIdSetting = await appConfigClient.getConfigurationSetting({
    key: 'microsoft_oauth_client_id_plain',
  });

  // Shared API JWT secret
  const jwtSigningSecret = (
    await kvClient.getSecret('api-jwt-signing-secret')
  ).value;

  // Plant-agent specific config
  const [plantStorageEndpointSetting] = await Promise.all([
    appConfigClient.getConfigurationSetting({ key: 'plants/storage_account_endpoint' }).catch(() => ({ value: null })),
  ]);

  const [anthropicApiKey, vapidPublicKey, vapidPrivateKey, notifyApiKey] = (
    await Promise.all([
      kvClient.getSecret('plant-agent-anthropic-api-key').catch(() => ({ value: null })),
      kvClient.getSecret('plant-agent-vapid-public-key').catch(() => ({ value: null })),
      kvClient.getSecret('plant-agent-vapid-private-key').catch(() => ({ value: null })),
      kvClient.getSecret('plant-agent-notify-api-key').catch(() => ({ value: null })),
    ])
  ).map((s) => s.value);

  const config = {
    // Shared
    cosmosDbEndpoint: cosmosEndpointSetting.value,
    jwtSigningSecret,
    microsoftClientId: microsoftClientIdSetting.value,

    // Plant-agent
    storageAccountEndpoint: plantStorageEndpointSetting.value,
    anthropicApiKey,
    vapidPublicKey,
    vapidPrivateKey,
    notifyApiKey,
  };

  const required = ['cosmosDbEndpoint', 'jwtSigningSecret', 'microsoftClientId'];
  for (const key of required) {
    if (!config[key]) {
      throw new Error(`Configuration value "${key}" is missing or empty.`);
    }
  }

  if (!config.anthropicApiKey) {
    console.warn('[appConfig] Anthropic API key not found — AI features will be unavailable');
  }
  if (!config.vapidPublicKey || !config.vapidPrivateKey) {
    console.warn('[appConfig] VAPID keys not found — push notifications will be unavailable');
  }

  console.log('[appConfig] Application config fetched from Azure App Configuration');
  return config;
}
