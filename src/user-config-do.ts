// Durable Object for managing multi-tenant user configurations
import { DurableObject } from 'cloudflare:workers';
import { CryptoUtils } from './crypto';
import {
  UserConfig,
  StoredUserConfig,
  UserInstallationToken,
  RegistrationSummary,
  InstallationDirectory,
  UserRegistrationResponse,
  UserDeletionResponse,
  UserRegistrationRequest,
} from './types';

type InstallationDirectoryState = {
  userIds: string[];
  lastMigratedAt?: number;
};

const MAX_PROJECT_LABEL_LENGTH = 64;

export class UserConfigDO extends DurableObject {
  private encryptionKey: CryptoKey | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /**
   * Initialize or retrieve the encryption key for this Durable Object
   */
  private async getEncryptionKey(): Promise<CryptoKey> {
    if (this.encryptionKey) return this.encryptionKey;

    const storedKeyData =
      await this.ctx.storage.get<ArrayBuffer>('encryption_key');
    if (storedKeyData) {
      this.encryptionKey = await CryptoUtils.importKey(storedKeyData);
    } else {
      this.encryptionKey = await CryptoUtils.generateKey();
      const keyData = await CryptoUtils.exportKey(this.encryptionKey);
      await this.ctx.storage.put('encryption_key', keyData);
    }

    return this.encryptionKey;
  }

  /**
   * Handle HTTP requests to the User Configuration Durable Object
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      switch (`${method} ${path}`) {
        case 'POST /register':
          return this.registerUser(request);
        case 'GET /user':
          return this.getUser(request);
        case 'PUT /user':
          return this.updateUser(request);
        case 'DELETE /user':
          return this.deleteUser(request);
        case 'GET /user-by-installation':
          return this.getUserByInstallation(request);
        case 'POST /installation-token':
          return this.storeInstallationToken(request);
        case 'GET /installation-token':
          return this.getInstallationToken(request);
        case 'GET /users':
          return this.listUsers();
        default:
          return new Response('Not Found', { status: 404 });
      }
    } catch (error) {
      console.error('UserConfigDO error:', error);
      return new Response(
        JSON.stringify({
          error: 'Internal error',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  /**
   * Register a new user with their Installation ID and Anthropic API key
   */
  private async registerUser(request: Request): Promise<Response> {
    const data = (await request.json()) as UserRegistrationRequest;

    if (!data.installationId || !data.anthropicApiKey) {
      return new Response(
        JSON.stringify({
          error: 'installationId and anthropicApiKey are required',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Generate userId if not provided
    const userId =
      data.userId ||
      `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Normalize optional project label
    let projectLabel = data.projectLabel?.trim();
    if (projectLabel && projectLabel.length > MAX_PROJECT_LABEL_LENGTH) {
      projectLabel = projectLabel.slice(0, MAX_PROJECT_LABEL_LENGTH);
    }

    const directory = await this.getOrCreateInstallationDirectory(
      data.installationId,
    );

    // Disallow duplicate user IDs
    if (directory.userIds.includes(userId)) {
      return new Response(
        JSON.stringify({
          error: 'UserId already exists for this installation',
          registrations: await this.mapDirectoryToSummaries(directory),
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Encrypt the Anthropic API key
    const key = await this.getEncryptionKey();
    const encryptedApiKey = await CryptoUtils.encrypt(
      key,
      data.anthropicApiKey,
    );

    const userConfig: StoredUserConfig = {
      userId,
      installationId: data.installationId,
      encryptedAnthropicApiKey: encryptedApiKey,
      repositoryAccess: [], // Will be populated when we fetch from GitHub
      created: Date.now(),
      updated: Date.now(),
      isActive: true,
      projectLabel: projectLabel ?? null,
    };

    // Store the user configuration
    await this.ctx.storage.put(`user:${userId}`, userConfig);

    directory.userIds.push(userId);
    await this.putInstallationDirectory(data.installationId, directory);

    const responsePayload: UserRegistrationResponse = {
      success: true,
      userId,
      installationId: data.installationId,
      existingRegistrations: await this.mapDirectoryToSummaries(directory, {
        excludeUserId: userId,
      }),
      projectLabel: projectLabel ?? null,
      message: 'User registered successfully',
    };

    console.log(
      `✅ Registered new user: ${userId} with installation: ${data.installationId}`,
    );

    return new Response(
      JSON.stringify(responsePayload),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    );
  }

  /**
   * Get user configuration by userId
   */
  private async getUser(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'userId parameter is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const storedConfig = await this.ctx.storage.get<StoredUserConfig>(
      `user:${userId}`,
    );
    if (!storedConfig) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Decrypt the Anthropic API key
    const key = await this.getEncryptionKey();
    const anthropicApiKey = await CryptoUtils.decrypt(
      key,
      storedConfig.encryptedAnthropicApiKey,
    );

    const directory = await this.getInstallationDirectory(
      storedConfig.installationId,
    );

    const existingRegistrations = directory
      ? await this.mapDirectoryToSummaries(directory, {
          excludeUserId: storedConfig.userId,
        })
      : [];

    const userConfig: UserConfig = {
      userId: storedConfig.userId,
      installationId: storedConfig.installationId,
      anthropicApiKey,
      repositoryAccess: storedConfig.repositoryAccess,
      created: storedConfig.created,
      updated: storedConfig.updated,
      isActive: storedConfig.isActive,
      projectLabel: storedConfig.projectLabel ?? null,
      existingRegistrations,
    };

    return new Response(JSON.stringify(userConfig), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Get user configuration by Installation ID
   */
  private async getUserByInstallation(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const installationId = url.searchParams.get('installationId');

    if (!installationId) {
      return new Response(
        JSON.stringify({ error: 'installationId parameter is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const directory = await this.getInstallationDirectory(installationId);
    if (!directory || directory.userIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'User not found for installation ID' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const registrations = await this.mapDirectoryToSummaries(directory);
    const responsePayload: InstallationDirectory = {
      installationId,
      registrations,
      lastMigratedAt: directory.lastMigratedAt,
    };

    return new Response(JSON.stringify(responsePayload), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Update user configuration
   */
  private async updateUser(request: Request): Promise<Response> {
    const data = (await request.json()) as {
      userId: string;
      anthropicApiKey?: string;
      repositoryAccess?: string[];
      isActive?: boolean;
      projectLabel?: string | null;
    };

    if (!data.userId) {
      return new Response(JSON.stringify({ error: 'userId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const storedConfig = await this.ctx.storage.get<StoredUserConfig>(
      `user:${data.userId}`,
    );
    if (!storedConfig) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Update fields if provided
    const updatedConfig: StoredUserConfig = {
      ...storedConfig,
      updated: Date.now(),
    };

    if (data.projectLabel !== undefined) {
      const trimmed = data.projectLabel?.trim();
      if (trimmed && trimmed.length > MAX_PROJECT_LABEL_LENGTH) {
        updatedConfig.projectLabel = trimmed.slice(0, MAX_PROJECT_LABEL_LENGTH);
      } else {
        updatedConfig.projectLabel = trimmed ?? null;
      }
    }

    if (data.anthropicApiKey) {
      const key = await this.getEncryptionKey();
      updatedConfig.encryptedAnthropicApiKey = await CryptoUtils.encrypt(
        key,
        data.anthropicApiKey,
      );
    }

    if (data.repositoryAccess !== undefined) {
      updatedConfig.repositoryAccess = data.repositoryAccess;
    }

    if (data.isActive !== undefined) {
      updatedConfig.isActive = data.isActive;
    }

    await this.ctx.storage.put(`user:${data.userId}`, updatedConfig);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'User updated successfully',
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  /**
   * Delete user configuration
   */
  private async deleteUser(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');

    if (!userId) {
      return new Response(
        JSON.stringify({ error: 'userId parameter is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const storedConfig = await this.ctx.storage.get<StoredUserConfig>(
      `user:${userId}`,
    );
    if (!storedConfig) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Remove user configuration
    await this.ctx.storage.delete(`user:${userId}`);

    const directory = await this.getInstallationDirectory(
      storedConfig.installationId,
    );

    let remaining: RegistrationSummary[] = [];
    if (directory) {
      directory.userIds = directory.userIds.filter((id) => id !== userId);
      if (directory.userIds.length === 0) {
        await this.deleteInstallationDirectory(storedConfig.installationId);
      } else {
        await this.putInstallationDirectory(
          storedConfig.installationId,
          directory,
        );
        remaining = await this.mapDirectoryToSummaries(directory);
      }
    }

    // Remove any cached installation tokens
    const tokenKey = `token:${storedConfig.installationId}`;
    await this.ctx.storage.delete(tokenKey);

    const responsePayload: UserDeletionResponse = {
      success: true,
      removedUserId: userId,
      installationId: storedConfig.installationId,
      remainingRegistrations: remaining,
      message: 'User deleted successfully',
    };

    return new Response(JSON.stringify(responsePayload), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Store installation access token with expiry
   */
  private async storeInstallationToken(request: Request): Promise<Response> {
    const data = (await request.json()) as {
      installationId: string;
      token: string;
      expiresAt: number;
      userId: string;
    };

    const tokenData: UserInstallationToken = {
      installationId: data.installationId,
      token: data.token,
      expiresAt: data.expiresAt,
      userId: data.userId,
    };

    await this.ctx.storage.put(`token:${data.installationId}`, tokenData);

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Get cached installation access token
   */
  private async getInstallationToken(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const installationId = url.searchParams.get('installationId');

    if (!installationId) {
      return new Response(
        JSON.stringify({ error: 'installationId parameter is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const tokenData = await this.ctx.storage.get<UserInstallationToken>(
      `token:${installationId}`,
    );
    if (!tokenData) {
      return new Response(JSON.stringify({ error: 'Token not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if token is expired (with 5 minute buffer)
    const now = Date.now();
    const bufferTime = 5 * 60 * 1000; // 5 minutes
    if (tokenData.expiresAt - now < bufferTime) {
      await this.ctx.storage.delete(`token:${installationId}`);
      return new Response(JSON.stringify({ error: 'Token expired' }), {
        status: 410,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(tokenData), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * List all users (admin endpoint)
   */
  private async listUsers(): Promise<Response> {
    const users: UserConfig[] = [];
    const userMap = await this.ctx.storage.list({ prefix: 'user:' });

    for (const [key, storedConfig] of userMap) {
      if (typeof storedConfig === 'object' && storedConfig !== null) {
        const config = storedConfig as StoredUserConfig;
        try {
          const key = await this.getEncryptionKey();
          const anthropicApiKey = await CryptoUtils.decrypt(
            key,
            config.encryptedAnthropicApiKey,
          );
          users.push({
            userId: config.userId,
            installationId: config.installationId,
            anthropicApiKey: '***REDACTED***', // Don't return actual API key in list
            repositoryAccess: config.repositoryAccess,
            created: config.created,
            updated: config.updated,
            isActive: config.isActive,
            projectLabel: config.projectLabel ?? null,
          });
        } catch (error) {
          console.error(
            `Failed to decrypt API key for user ${config.userId}:`,
            error,
          );
        }
      }
    }

    return new Response(JSON.stringify({ users, count: users.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Helper method to find user by installation ID
   */
  private async getInstallationDirectory(
    installationId: string,
  ): Promise<InstallationDirectoryState | null> {
    const raw = await this.ctx.storage.get<
      string | InstallationDirectoryState
    >(`installation:${installationId}`);

    if (!raw) {
      return null;
    }

    if (typeof raw === 'string') {
      const migrated: InstallationDirectoryState = {  
        userIds: [raw],
        lastMigratedAt: Date.now(),
      };
      await this.ctx.storage.put(
        `installation:${installationId}`,
        migrated,
      );
      return migrated;
    }

    return { ...raw, userIds: [...raw.userIds] };
  }

  private async getOrCreateInstallationDirectory(
    installationId: string,
  ): Promise<InstallationDirectoryState> {
    const existing = await this.getInstallationDirectory(installationId);
    if (existing) {
      return existing;
    }

    const directory: InstallationDirectoryState = { userIds: [] };
    await this.ctx.storage.put(`installation:${installationId}`, directory);
    return directory;
  }

  private async putInstallationDirectory(
    installationId: string,
    directory: InstallationDirectoryState,
  ): Promise<void> {
    await this.ctx.storage.put(`installation:${installationId}`, directory);
  }

  private async deleteInstallationDirectory(
    installationId: string,
  ): Promise<void> {
    await this.ctx.storage.delete(`installation:${installationId}`);
  }

  private async mapDirectoryToSummaries(
    directory: InstallationDirectoryState,
    options: { excludeUserId?: string } = {},
  ): Promise<RegistrationSummary[]> {
    const { excludeUserId } = options;
    const results: RegistrationSummary[] = [];

    for (const userId of directory.userIds) {
      if (excludeUserId && userId === excludeUserId) continue;

      const storedConfig = await this.ctx.storage.get<StoredUserConfig>(
        `user:${userId}`,
      );
      if (!storedConfig) continue;

      results.push({
        userId: storedConfig.userId,
        projectLabel: storedConfig.projectLabel ?? null,
        created: storedConfig.created,
        updated: storedConfig.updated,
        isActive: storedConfig.isActive,
      });
    }

    return results;
  }
}
