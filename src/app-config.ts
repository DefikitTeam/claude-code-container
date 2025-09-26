// Fixed GitHub App Configuration
// These credentials are controlled by the service provider and hardcoded
// Users will only provide their Installation ID and Anthropic API key

import { FixedGitHubAppConfig } from './types';

/**
 * Fixed GitHub App Configuration
 *
 * SETUP INSTRUCTIONS:
 * 1. Replace these values with your actual GitHub App credentials
 * 2. Keep these credentials secure and never expose them to users
 * 3. Users will only need to provide their Installation ID after installing your app
 */
export const FIXED_GITHUB_APP_CONFIG: FixedGitHubAppConfig = {
  // TODO: Replace with your actual GitHub App ID
  appId: process.env.FIXED_GITHUB_APP_ID || 'YOUR_GITHUB_APP_ID_HERE',

  // TODO: Replace with your actual GitHub App Private Key
  privateKey:
    process.env.FIXED_GITHUB_PRIVATE_KEY ||
    `-----BEGIN RSA PRIVATE KEY-----
YOUR_PRIVATE_KEY_HERE
-----END RSA PRIVATE KEY-----`,

  // TODO: Replace with your actual GitHub App Webhook Secret
  webhookSecret:
    process.env.FIXED_GITHUB_WEBHOOK_SECRET || 'YOUR_WEBHOOK_SECRET_HERE',
};

/**
 * Validate that the fixed app configuration is properly set
 */
export function validateFixedAppConfig(): boolean {
  const config = FIXED_GITHUB_APP_CONFIG;

  if (config.appId === 'YOUR_GITHUB_APP_ID_HERE' || !config.appId) {
    console.error('❌ FIXED_GITHUB_APP_ID is not configured');
    return false;
  }

  if (
    config.privateKey.includes('YOUR_PRIVATE_KEY_HERE') ||
    !config.privateKey
  ) {
    console.error('❌ FIXED_GITHUB_PRIVATE_KEY is not configured');
    return false;
  }

  if (
    config.webhookSecret === 'YOUR_WEBHOOK_SECRET_HERE' ||
    !config.webhookSecret
  ) {
    console.error('❌ FIXED_GITHUB_WEBHOOK_SECRET is not configured');
    return false;
  }

  console.log('✅ Fixed GitHub App configuration validated');
  return true;
}

/**
 * Get the fixed GitHub App configuration
 * This replaces the old dynamic configuration retrieval
 */
export function getFixedGitHubAppConfig(): FixedGitHubAppConfig {
  // In developer / self-hosted setups we may not have the fixed GitHub App
  // configured. Avoid throwing here so runtime endpoints like /process-prompt
  // can run in a degraded mode (they will surface clearer errors when they
  // actually try to call GitHub APIs).
  if (!validateFixedAppConfig()) {
    console.warn(
      '⚠️ FIXED_GITHUB_APP_CONFIG is not fully configured - proceeding without strict validation',
    );
  }

  return FIXED_GITHUB_APP_CONFIG;
}
