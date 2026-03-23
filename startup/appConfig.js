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

  // My-homepage specific config
  // Resolve App Config Key Vault references → actual secret values
  async function resolveKvReference(setting) {
    const { uri } = JSON.parse(setting.value);
    const secretName = new URL(uri).pathname.split('/')[2];
    return (await kvClient.getSecret(secretName)).value;
  }

  const [homepageAuth0DomainSetting, homepageAuth0ClientIdSetting, homepageAuth0ClientSecretSetting, homepageStorageEndpointSetting] =
    await Promise.all([
      appConfigClient.getConfigurationSetting({ key: 'homepage/AUTH0_DOMAIN' }).catch(() => ({ value: null })),
      appConfigClient.getConfigurationSetting({ key: 'homepage/AUTH0_APPLE_CLIENT_ID' }).catch(() => ({ value: null })),
      appConfigClient.getConfigurationSetting({ key: 'homepage/AUTH0_APPLE_CLIENT_SECRET' }).catch(() => ({ value: null })),
      appConfigClient.getConfigurationSetting({ key: 'homepage/storage_account_endpoint' }).catch(() => ({ value: null })),
    ]);

  const [googleClientIdSetting, googleClientSecretSetting, microsoftClientSecretSetting] =
    await Promise.all([
      appConfigClient.getConfigurationSetting({ key: 'google_oauth_client_id' }).catch(() => ({ value: null })),
      appConfigClient.getConfigurationSetting({ key: 'google_oauth_client_secret' }).catch(() => ({ value: null })),
      appConfigClient.getConfigurationSetting({ key: 'microsoft_oauth_client_secret' }).catch(() => ({ value: null })),
    ]);

  const [googleClientId, googleClientSecret, microsoftClientSecret] = await Promise.all([
    googleClientIdSetting?.value ? resolveKvReference(googleClientIdSetting).catch(() => null) : null,
    googleClientSecretSetting?.value ? resolveKvReference(googleClientSecretSetting).catch(() => null) : null,
    microsoftClientSecretSetting?.value ? resolveKvReference(microsoftClientSecretSetting).catch(() => null) : null,
  ]);

  const [githubClientId, githubClientSecret, homepageJwtSigningSecret] = (
    await Promise.all([
      kvClient.getSecret('github-oauth-client-id').catch(() => ({ value: null })),
      kvClient.getSecret('github-oauth-client-secret').catch(() => ({ value: null })),
      kvClient.getSecret('my-homepage-jwt-signing-secret').catch(() => ({ value: null })),
    ])
  ).map((s) => s.value);

  // Also resolve microsoft_oauth_client_id for homepage (it needs the actual ID string, not just _plain)
  const microsoftOAuthClientIdSetting = await appConfigClient
    .getConfigurationSetting({ key: 'microsoft_oauth_client_id' })
    .catch(() => null);
  const homepageMicrosoftClientId = microsoftOAuthClientIdSetting?.value
    ? await resolveKvReference(microsoftOAuthClientIdSetting).catch(() => null)
    : null;

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

    // My-homepage
    homepage: {
      jwtSigningSecret: homepageJwtSigningSecret,
      githubClientId,
      githubClientSecret,
      googleClientId,
      googleClientSecret,
      microsoftClientId: homepageMicrosoftClientId,
      microsoftClientSecret,
      auth0Domain: homepageAuth0DomainSetting?.value,
      auth0AppleClientId: homepageAuth0ClientIdSetting?.value,
      auth0AppleClientSecret: homepageAuth0ClientSecretSetting?.value,
      storageAccountEndpoint: homepageStorageEndpointSetting?.value,
    },
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
  if (!config.homepage.jwtSigningSecret) {
    console.warn('[appConfig] Homepage JWT secret not found — homepage auth will be unavailable');
  }

  console.log('[appConfig] Application config fetched from Azure App Configuration');
  return config;
}
