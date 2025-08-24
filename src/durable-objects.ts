import { DurableObject } from 'cloudflare:workers';
import { Container } from '@cloudflare/containers';
import { Env, GitHubAppConfig, StoredGitHubConfig } from './types';
import { CryptoUtils, EncryptedData } from './crypto';

/**
 * Durable Object for secure GitHub App configuration storage
 */
export class GitHubAppConfigDO extends DurableObject<Env> {
  private encryptionKey: CryptoKey | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const method = request.method;

      switch (`${method} ${url.pathname}`) {
        case 'POST /store':
          return await this.storeConfig(request);
        case 'GET /retrieve':
          return await this.retrieveConfig();
        case 'POST /update-token':
          return await this.updateInstallationToken(request);
        case 'DELETE /clear':
          return await this.clearConfig();
        default:
          return new Response('Not found', { status: 404 });
      }
    } catch (error) {
      console.error('GitHubAppConfigDO error:', error);
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  /**
   * Initialize or retrieve the encryption key
   */
  private async getEncryptionKey(): Promise<CryptoKey> {
    if (this.encryptionKey) {
      return this.encryptionKey;
    }

    // Try to retrieve existing key
    const storedKeyData = await this.ctx.storage.get<ArrayBuffer>('encryption_key');
    
    if (storedKeyData) {
      this.encryptionKey = await CryptoUtils.importKey(storedKeyData);
    } else {
      // Generate new key
      this.encryptionKey = await CryptoUtils.generateKey();
      const keyData = await CryptoUtils.exportKey(this.encryptionKey);
      await this.ctx.storage.put('encryption_key', keyData);
    }

    return this.encryptionKey;
  }

  /**
   * Store encrypted GitHub App configuration
   */
  private async storeConfig(request: Request): Promise<Response> {
    const config = await request.json() as GitHubAppConfig;
    
    if (!config.appId || !config.privateKey || !config.webhookSecret) {
      return new Response(
        JSON.stringify({ error: 'Missing required configuration fields' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const key = await this.getEncryptionKey();
    
    // Encrypt sensitive data
    const encryptedPrivateKey = await CryptoUtils.encrypt(key, config.privateKey);
    const encryptedWebhookSecret = await CryptoUtils.encrypt(key, config.webhookSecret);
    
    const encryptedInstallationToken = config.installationToken 
      ? await CryptoUtils.encrypt(key, config.installationToken)
      : null;

    // Store encrypted configuration
    const storedConfig: StoredGitHubConfig = {
      appId: config.appId,
      encryptedPrivateKey,
      encryptedWebhookSecret,
      installationId: config.installationId,
      encryptedInstallationToken,
      tokenExpiresAt: config.tokenExpiresAt,
      updatedAt: new Date().toISOString()
    };

    await this.ctx.storage.put('github_config', storedConfig);

    return new Response(
      JSON.stringify({ success: true, message: 'Configuration stored successfully' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  /**
   * Retrieve and decrypt GitHub App configuration
   */
  private async retrieveConfig(): Promise<Response> {
    const storedConfig = await this.ctx.storage.get<StoredGitHubConfig>('github_config');
    
    if (!storedConfig) {
      return new Response(
        JSON.stringify({ error: 'No configuration found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const key = await this.getEncryptionKey();
    
    try {
      // Decrypt sensitive data
      const privateKey = await CryptoUtils.decrypt(key, storedConfig.encryptedPrivateKey);
      const webhookSecret = await CryptoUtils.decrypt(key, storedConfig.encryptedWebhookSecret);
      
      const installationToken = storedConfig.encryptedInstallationToken
        ? await CryptoUtils.decrypt(key, storedConfig.encryptedInstallationToken)
        : undefined;

      const config: GitHubAppConfig = {
        appId: storedConfig.appId,
        privateKey,
        webhookSecret,
        installationId: storedConfig.installationId,
        installationToken,
        tokenExpiresAt: storedConfig.tokenExpiresAt
      };

      return new Response(
        JSON.stringify(config),
        { headers: { 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      console.error('Failed to decrypt configuration:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to decrypt configuration' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  /**
   * Update installation token
   */
  private async updateInstallationToken(request: Request): Promise<Response> {
    const { token, expiresAt } = await request.json() as { 
      token: string; 
      expiresAt?: number 
    };

    const storedConfig = await this.ctx.storage.get<StoredGitHubConfig>('github_config');
    if (!storedConfig) {
      return new Response(
        JSON.stringify({ error: 'No configuration found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const key = await this.getEncryptionKey();
    const encryptedToken = await CryptoUtils.encrypt(key, token);

    // Update stored configuration
    const updatedConfig: StoredGitHubConfig = {
      ...storedConfig,
      encryptedInstallationToken: encryptedToken,
      tokenExpiresAt: expiresAt,
      updatedAt: new Date().toISOString()
    };

    await this.ctx.storage.put('github_config', updatedConfig);

    return new Response(
      JSON.stringify({ success: true, message: 'Token updated successfully' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }

  /**
   * Clear all stored configuration
   */
  private async clearConfig(): Promise<Response> {
    await this.ctx.storage.deleteAll();
    this.encryptionKey = null;

    return new Response(
      JSON.stringify({ success: true, message: 'Configuration cleared' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * Container class for Claude Code processing
 */
export class MyContainer extends Container<Env> {
  // Port the container listens on (default: 8080)
  defaultPort = 8080;
  // Time before container sleeps due to inactivity (allow time for GitHub issue processing)
  sleepAfter = "5m"; // 5 minutes - enough for most GitHub issue processing
  // Environment variables passed to the container
  envVars = {
    ANTHROPIC_API_KEY: this.env.ANTHROPIC_API_KEY || '',
    NODE_ENV: 'development',
    CONTAINER_ID: crypto.randomUUID(),
    PORT: "8080",
  };
  // Specify the command to run in the container
  cmd = ["npm", "start"];

  /**
   * Override fetch to handle errors gracefully
   */
  async fetch(request: Request): Promise<Response> {
    try {
      return await super.fetch(request);
    } catch (error) {
      console.error('Container fetch error:', error);
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Container request failed', 
          error: error instanceof Error ? error.message : String(error) 
        }),
        { 
          status: 500, 
          headers: { 'Content-Type': 'application/json' } 
        }
      );
    }
  }

  /**
   * Lifecycle method called when container shuts down
   * Override this method to handle Container stopped events gracefully
   */
  onStop(params: { exitCode: number; reason: string }) {
    try {
      console.log('Container stopped gracefully:', {
        exitCode: params.exitCode,
        reason: params.reason,
        timestamp: new Date().toISOString()
      });
      // Don't throw errors here - just log the shutdown
    } catch (error) {
      console.error('Error in onStop (non-fatal):', error);
      // Swallow the error to prevent the repeated error messages
    }
  }

  /**
   * Lifecycle method called when container encounters an error
   * Override this method to handle container errors gracefully
   */
  onError(error: Error) {
    try {
      console.error('Container error:', {
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      // Don't rethrow - just log the error
    } catch (logError) {
      console.error('Error logging container error (non-fatal):', logError);
    }
  }
}