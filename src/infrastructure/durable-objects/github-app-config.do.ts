/**
 * GitHub App Config Durable Object
 * Stores GitHub app configuration and credentials
 */

import { DurableObject } from 'cloudflare:workers';
import { ValidationError } from '../../shared/errors/validation.error';

interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  installationId: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  createdAt: number;
  updatedAt: number;
}

export class GitHubAppConfigDO extends DurableObject {
  private readonly CONFIG_KEY = 'github:app:config';
  private readonly INSTALLATION_PREFIX = 'github:installation:';

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
  }

  /**
   * Convert absolute expiration into a usable TTL window in seconds
   */
  private calculateTtl(expiresAt: number): number | null {
    if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
      return null;
    }

    const ttlMs = expiresAt - Date.now();
    if (ttlMs <= 0) {
      return null;
    }

    const ttlSeconds = Math.ceil(ttlMs / 1000);
    return ttlSeconds > 0 ? ttlSeconds : null;
  }

  /**
   * Save or update GitHub app configuration
   */
  async saveConfig(config: GitHubAppConfig): Promise<void> {
    if (!config.appId || !config.privateKey) {
      throw new ValidationError('appId and privateKey are required');
    }

    try {
      const data = {
        ...config,
        updatedAt: Date.now(),
      };

      await this.ctx.storage.put(this.CONFIG_KEY, JSON.stringify(data));
    } catch (error) {
      throw new Error(
        `Failed to save config: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Get GitHub app configuration
   */
  async getConfig(): Promise<GitHubAppConfig | null> {
    try {
      const value = await this.ctx.storage.get(this.CONFIG_KEY);
      return value ? JSON.parse(value as string) : null;
    } catch (error) {
      throw new Error(
        `Failed to get config: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Store installation token with expiration
   */
  async cacheInstallationToken(
    installationId: string,
    token: string,
    expiresAt: number,
  ): Promise<void> {
    try {
      const key = `${this.INSTALLATION_PREFIX}${installationId}`;
      const ttlSeconds = this.calculateTtl(expiresAt);

      if (ttlSeconds === null) {
        await this.ctx.storage.delete(key);
        return;
      }

      const bufferedExpiresAt = Date.now() + (ttlSeconds + 1) * 1000;

      await this.ctx.storage.put(
        key,
        JSON.stringify({ token, expiresAt: bufferedExpiresAt }),
      );
    } catch (error) {
      throw new Error(
        `Failed to cache token: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Get cached installation token
   */
  async getInstallationToken(
    installationId: string,
  ): Promise<{ token: string; expiresAt: number } | null> {
    try {
      const key = `${this.INSTALLATION_PREFIX}${installationId}`;
      const value = await this.ctx.storage.get(key);
      if (!value) {
        return null;
      }

      const cached = JSON.parse(value as string) as {
        token: string;
        expiresAt: number;
      };
      if (cached.expiresAt <= Date.now()) {
        await this.ctx.storage.delete(key);
        return null;
      }

      return cached;
    } catch (error) {
      throw new Error(
        `Failed to get token: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Invalidate installation token
   */
  async invalidateInstallationToken(installationId: string): Promise<void> {
    try {
      const key = `${this.INSTALLATION_PREFIX}${installationId}`;
      await this.ctx.storage.delete(key);
    } catch (error) {
      throw new Error(
        `Failed to invalidate token: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * HTTP handler
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/config') {
      try {
        const config = await this.getConfig();
        return new Response(JSON.stringify(config), { status: 200 });
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 500,
          },
        );
      }
    }

    if (request.method === 'POST' && url.pathname === '/config') {
      try {
        const config = await request.json<GitHubAppConfig>();
        await this.saveConfig(config);
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 400,
          },
        );
      }
    }

    if (request.method === 'GET' && url.pathname === '/token') {
      try {
        const installationId = url.searchParams.get('installationId');
        if (!installationId) {
          return new Response(
            JSON.stringify({ error: 'installationId required' }),
            { status: 400 },
          );
        }
        const token = await this.getInstallationToken(installationId);
        return new Response(JSON.stringify(token), { status: 200 });
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 500,
          },
        );
      }
    }

    return new Response('Not Found', { status: 404 });
  }
}
