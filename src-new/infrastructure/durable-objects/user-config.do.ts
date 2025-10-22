/**
 * User Config Durable Object
 * Persistent storage for user configurations, tokens, and authentication
 *
 * Implements: IUserRepository
 */

import { DurableObject } from 'cloudflare:workers';
import { UserEntity, UserProps } from '../../core/entities/user.entity';
import { IUserRepository } from '../../core/interfaces/repositories/user.repository';
import { ValidationError } from '../../shared/errors/validation.error';

/**
 * Cached token storage structure
 */
export interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * User Config Durable Object
 * Manages user data persistence and token caching
 */
export class UserConfigDO extends DurableObject implements IUserRepository {
  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
  }

  /**
   * Storage key prefixes
   */
  private readonly USERS_PREFIX = 'user:';
  private readonly TOKENS_PREFIX = 'token:';
  private readonly INDEX_PREFIX = 'index:';

  /**
   * Convert an absolute expiry timestamp into a TTL value accepted by DO storage
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
   * Save or update a user
   */
  async save(user: UserEntity): Promise<void> {
    if (!user || !user.userId || !user.installationId) {
      throw new ValidationError('Invalid user entity');
    }

    try {
      const key = this.getUserKey(user.userId, user.installationId);
      const userData = user.getProps();

      await this.ctx.storage.put(key, JSON.stringify(userData));

      await this.updateInstallationIndex(user.installationId, user.userId, true);
    } catch (error) {
      throw new Error(
        `Failed to save user ${user.userId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Find a user by ID
   */
  async findById(userId: string): Promise<UserEntity | null> {
    if (!userId || typeof userId !== 'string') {
      throw new ValidationError('userId must be a non-empty string');
    }

    try {
      const allEntries = await this.ctx.storage.list({ prefix: this.USERS_PREFIX });

      if (!allEntries) {
        return null;
      }

      for (const [key] of allEntries) {
        const value = await this.ctx.storage.get(key);
        if (value) {
          const userData = JSON.parse(value as string);
          if (userData.userId === userId) {
            return new UserEntity(userData);
          }
        }
      }

      return null;
    } catch (error) {
      throw new Error(`Failed to find user ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Find all users for an installation
   */
  async findByInstallationId(installationId: string): Promise<UserEntity[]> {
    if (!installationId || typeof installationId !== 'string') {
      throw new ValidationError('installationId must be a non-empty string');
    }

    try {
      const users: UserEntity[] = [];
      const prefix = `${this.USERS_PREFIX}${installationId}:`;
      const entries = await this.ctx.storage.list({ prefix });

      if (!entries) {
        return users;
      }

      for (const [, value] of entries) {
        const userData = JSON.parse(value as string);
        users.push(new UserEntity(userData));
      }

      return users;
    } catch (error) {
      throw new Error(
        `Failed to find users for installation ${installationId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Delete a user
   */
  async delete(userId: string): Promise<void> {
    if (!userId || typeof userId !== 'string') {
      throw new ValidationError('userId must be a non-empty string');
    }

    try {
      const allEntries = await this.ctx.storage.list({ prefix: this.USERS_PREFIX });

      if (allEntries) {
        for (const [key, value] of allEntries) {
          const userData = JSON.parse(value as string);
          if (userData.userId === userId) {
            await this.ctx.storage.delete(key);

            const tokenKey = `${this.TOKENS_PREFIX}${userData.installationId}:${userId}`;
            await this.ctx.storage.delete(tokenKey);

            await this.updateInstallationIndex(userData.installationId, userId, false);
          }
        }
      }
    } catch (error) {
      throw new Error(`Failed to delete user ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List all active users for an installation
   */
  async listByInstallation(installationId: string): Promise<UserEntity[]> {
    const users = await this.findByInstallationId(installationId);
    return users.filter((user) => user.isActive);
  }

  /**
   * Cache an installation token
   */
  async cacheToken(installationId: string, userId: string, token: string, expiresAt: number): Promise<void> {
    try {
      const key = `${this.TOKENS_PREFIX}${installationId}:${userId}`;
      const ttlSeconds = this.calculateTtl(expiresAt);

      if (ttlSeconds === null) {
        await this.ctx.storage.delete(key);
        return;
      }

      const bufferedExpiresAt = Date.now() + (ttlSeconds + 1) * 1000;
      const cachedToken: CachedToken = { token, expiresAt: bufferedExpiresAt };

      await this.ctx.storage.put(key, JSON.stringify(cachedToken));
    } catch (error) {
      console.error(`Failed to cache token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get a cached installation token
   */
  async getCachedToken(installationId: string, userId: string): Promise<CachedToken | null> {
    try {
      const key = `${this.TOKENS_PREFIX}${installationId}:${userId}`;
      const value = await this.ctx.storage.get(key);

      if (!value) {
        return null;
      }

      const cached = JSON.parse(value as string) as CachedToken;

      if (cached.expiresAt <= Date.now()) {
        await this.ctx.storage.delete(key);
        return null;
      }

      return cached;
    } catch (error) {
      console.error(`Failed to get cached token: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return null;
    }
  }

  /**
   * Delete a cached token
   */
  async deleteCachedToken(installationId: string, userId: string): Promise<void> {
    try {
      const key = `${this.TOKENS_PREFIX}${installationId}:${userId}`;
      await this.ctx.storage.delete(key);
    } catch (error) {
      console.error(`Failed to delete cached token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private getUserKey(userId: string, installationId: string): string {
    return `${this.USERS_PREFIX}${installationId}:${userId}`;
  }

  private async updateInstallationIndex(
    installationId: string,
    userId: string,
    added: boolean,
  ): Promise<void> {
    try {
      const indexKey = `${this.INDEX_PREFIX}${installationId}`;
      const indexValue = await this.ctx.storage.get(indexKey);

      let users: string[] = indexValue ? JSON.parse(indexValue as string) : [];

      if (added && !users.includes(userId)) {
        users.push(userId);
      } else if (!added) {
        users = users.filter((id) => id !== userId);
      }

      await this.ctx.storage.put(indexKey, JSON.stringify(users));
    } catch (error) {
      console.error(`Failed to update installation index: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Fetch handler for HTTP requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST') {
      try {
        if (url.pathname === '/user') {
          const payload = await request.json<UserProps>();
          const user = new UserEntity(payload);
          await this.save(user);
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }

        if (url.pathname === '/token') {
          const { installationId, userId, token, expiresAt } = await request.json<{
            installationId: string;
            userId: string;
            token: string;
            expiresAt: number;
          }>();
          await this.cacheToken(installationId, userId, token, expiresAt);
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
          status: 400,
        });
      }
    }

    if (request.method === 'GET') {
      try {
        const userId = url.searchParams.get('userId');
        const installationId = url.searchParams.get('installationId');

        if (url.pathname === '/user' && userId) {
          const user = await this.findById(userId);
          return new Response(JSON.stringify(user ? user.getProps() : null), { status: 200 });
        }

        if (url.pathname === '/token' && installationId && userId) {
          const token = await this.getCachedToken(installationId, userId);
          return new Response(JSON.stringify(token), { status: 200 });
        }
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
          status: 400,
        });
      }
    }

    if (request.method === 'DELETE') {
      try {
        const userId = url.searchParams.get('userId');
        const installationId = url.searchParams.get('installationId');

        if (url.pathname === '/token' && installationId && userId) {
          await this.deleteCachedToken(installationId, userId);
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
          status: 400,
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  }
}
