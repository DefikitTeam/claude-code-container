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
const installationTokenKey = (installationId: string, userId: string) =>
  `token:${installationId}:${userId}`;
const legacyInstallationTokenKey = (installationId: string) =>
  `token:${installationId}`;
const registryTokenKey = (installationId: string, userId: string) =>
  `registry-token:${installationId}:${userId}`;

type RegistryTokenData = {
  installationId: string;
  userId: string;
  token: string;
  expires_at: string;
  registry_url?: string;
};

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
        case 'POST /user':
          return this.saveUser(request);
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
        case 'DELETE /installation-token':
          return this.deleteInstallationToken(request);
        case 'POST /registry-token':
          return this.storeRegistryToken(request);
        case 'GET /registry-token':
          return this.getRegistryToken(request);
        case 'DELETE /registry-token':
          return this.deleteRegistryToken(request);
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
   * 
   * Supports multiple users per installation (each with their own projectLabel).
   * Always generates a new userId to ensure uniqueness within the installation.
   * The userId provided in the request (if any) is ignored - worker manages userId generation.
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

    // Always generate a new userId - ignore any userId from request
    // This ensures each registration gets a unique ID within the installation
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Normalize optional project label
    let projectLabel = data.projectLabel?.trim();
    if (projectLabel && projectLabel.length > MAX_PROJECT_LABEL_LENGTH) {
      projectLabel = projectLabel.slice(0, MAX_PROJECT_LABEL_LENGTH);
    }

    const directory = await this.getOrCreateInstallationDirectory(
      data.installationId,
    );

    // NOTE: No duplicate userId check needed since userId is always generated fresh
    // Multiple users per installation are supported, each differentiated by projectLabel

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
   * Save user with explicit userId (for adapter compatibility)
   * Unlike /register which generates userId, this accepts user data from use cases
   */
  private async saveUser(request: Request): Promise<Response> {
    console.log('[UserConfigDO] saveUser called');
    
    const data = await request.json() as {
      userId: string;
      installationId: string;
      anthropicApiKey: string;
      repositoryAccess?: string[];
      projectLabel?: string | null;
      isActive?: boolean;
    };

    console.log('[UserConfigDO] saveUser data:', {
      userId: data.userId,
      installationId: data.installationId,
      hasApiKey: !!data.anthropicApiKey,
      repoCount: data.repositoryAccess?.length || 0,
    });

    if (!data.userId || !data.installationId || !data.anthropicApiKey) {
      console.error('[UserConfigDO] saveUser validation failed');
      return new Response(
        JSON.stringify({
          error: 'userId, installationId and anthropicApiKey are required',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Check if user already exists
    const existing = await this.ctx.storage.get<StoredUserConfig>(`user:${data.userId}`);
    
    if (existing) {
      console.log('[UserConfigDO] User exists, updating');
      // Update existing user
      return this.updateExistingUser(data);
    }

    console.log('[UserConfigDO] Creating new user');

    // Create new user with provided userId
    const directory = await this.getOrCreateInstallationDirectory(data.installationId);

    // Encrypt the Anthropic API key
    const key = await this.getEncryptionKey();
    const encryptedApiKey = await CryptoUtils.encrypt(
      key,
      data.anthropicApiKey,
    );

    const userConfig: StoredUserConfig = {
      userId: data.userId,
      installationId: data.installationId,
      encryptedAnthropicApiKey: encryptedApiKey,
      repositoryAccess: data.repositoryAccess || [],
      created: Date.now(),
      updated: Date.now(),
      isActive: data.isActive ?? true,
      projectLabel: data.projectLabel ?? null,
    };

    // Store the user configuration
    await this.ctx.storage.put(`user:${data.userId}`, userConfig);
    console.log('[UserConfigDO] Stored user config');

    // Add to directory if not already present
    if (!directory.userIds.includes(data.userId)) {
      directory.userIds.push(data.userId);
      await this.putInstallationDirectory(data.installationId, directory);
      console.log('[UserConfigDO] Added to directory');
    }

    console.log(`✅ Saved user: ${data.userId} for installation: ${data.installationId}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    );
  }

  /**
   * Helper to update existing user via saveUser endpoint
   */
  private async updateExistingUser(data: {
    userId: string;
    installationId: string;
    anthropicApiKey: string;
    repositoryAccess?: string[];
    projectLabel?: string | null;
    isActive?: boolean;
  }): Promise<Response> {
    const storedConfig = await this.ctx.storage.get<StoredUserConfig>(`user:${data.userId}`);
    
    if (!storedConfig) {
      return new Response(
        JSON.stringify({ error: 'User not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const key = await this.getEncryptionKey();
    const encryptedApiKey = await CryptoUtils.encrypt(key, data.anthropicApiKey);

    const updatedConfig: StoredUserConfig = {
      ...storedConfig,
      encryptedAnthropicApiKey: encryptedApiKey,
      repositoryAccess: data.repositoryAccess ?? storedConfig.repositoryAccess,
      projectLabel: data.projectLabel !== undefined ? data.projectLabel : storedConfig.projectLabel,
      isActive: data.isActive !== undefined ? data.isActive : storedConfig.isActive,
      updated: Date.now(),
    };

    await this.ctx.storage.put(`user:${data.userId}`, updatedConfig);

    console.log(`✅ Updated user: ${data.userId}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
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
    await this.ctx.storage.delete(
      installationTokenKey(
        storedConfig.installationId,
        storedConfig.userId,
      ),
    );
    await this.ctx.storage.delete(
      registryTokenKey(storedConfig.installationId, storedConfig.userId),
    );
    await this.ctx.storage.delete(
      legacyInstallationTokenKey(storedConfig.installationId),
    );

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
      installationId?: string;
      token?: string;
      expiresAt?: number | string;
      userId?: string;
    };

    const installationId = data.installationId?.trim();
    const userId = data.userId?.trim();
    const token = data.token;
    const expiresAtNumber = Number(data.expiresAt);

    if (!installationId || !userId || !token || !Number.isFinite(expiresAtNumber)) {
      return new Response(
        JSON.stringify({
          error:
            'installationId, userId, token, and numeric expiresAt are required',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const tokenData: UserInstallationToken = {
      installationId,
      token,
      expiresAt: expiresAtNumber,
      userId,
    };

    await this.ctx.storage.put(
      installationTokenKey(installationId, userId),
      tokenData,
    );

    // Remove legacy cache entries
    await this.ctx.storage.delete(legacyInstallationTokenKey(installationId));

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
    const userId = url.searchParams.get('userId');

    if (!installationId || !userId) {
      return new Response(
        JSON.stringify({
          error: 'installationId and userId parameters are required',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    let tokenData = await this.ctx.storage.get<UserInstallationToken>(
      installationTokenKey(installationId, userId),
    );

    if (!tokenData) {
      const legacyToken = await this.ctx.storage.get<UserInstallationToken>(
        legacyInstallationTokenKey(installationId),
      );
      if (legacyToken) {
        const migratedToken: UserInstallationToken = {
          installationId,
          token: legacyToken.token,
          expiresAt: legacyToken.expiresAt,
          userId: legacyToken.userId ?? userId,
        };

        await this.ctx.storage.put(
          installationTokenKey(installationId, migratedToken.userId),
          migratedToken,
        );
        await this.ctx.storage.delete(legacyInstallationTokenKey(installationId));

        if (migratedToken.userId === userId) {
          tokenData = migratedToken;
        }
      }
    }

    if (!tokenData || tokenData.userId !== userId) {
      return new Response(JSON.stringify({ error: 'Token not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if token is expired (with 5 minute buffer)
    const now = Date.now();
    const bufferTime = 5 * 60 * 1000; // 5 minutes
    if (tokenData.expiresAt - now < bufferTime) {
      await this.ctx.storage.delete(
        installationTokenKey(installationId, userId),
      );
      return new Response(JSON.stringify({ error: 'Token expired' }), {
        status: 410,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(tokenData), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async deleteInstallationToken(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const installationId = url.searchParams.get('installationId');
    const userId = url.searchParams.get('userId');

    if (!installationId || !userId) {
      return new Response(
        JSON.stringify({
          error: 'installationId and userId parameters are required',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    await this.ctx.storage.delete(installationTokenKey(installationId, userId));
    // Also clear legacy cache for safety
    await this.ctx.storage.delete(legacyInstallationTokenKey(installationId));

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async storeRegistryToken(request: Request): Promise<Response> {
    const data = (await request.json()) as Partial<RegistryTokenData>;

    const installationId = data.installationId?.trim();
    const userId = data.userId?.trim();
    const token = data.token;
    const expiresAt = data.expires_at;

    if (!installationId || !userId || !token || !expiresAt) {
      return new Response(
        JSON.stringify({
          error:
            'installationId, userId, token, and expires_at are required for registry token storage',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const payload: RegistryTokenData = {
      installationId,
      userId,
      token,
      expires_at: expiresAt,
      registry_url: data.registry_url,
    };

    await this.ctx.storage.put(
      registryTokenKey(installationId, userId),
      payload,
    );

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async getRegistryToken(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const installationId = url.searchParams.get('installationId');
    const userId = url.searchParams.get('userId');

    if (!installationId || !userId) {
      return new Response(
        JSON.stringify({
          error: 'installationId and userId parameters are required',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const data = await this.ctx.storage.get<RegistryTokenData>(
      registryTokenKey(installationId, userId),
    );

    if (!data) {
      return new Response(JSON.stringify({ error: 'Registry token not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const expiresAt = new Date(data.expires_at).getTime();
    const bufferTime = 5 * 60 * 1000;
    if (expiresAt - Date.now() < bufferTime) {
      await this.ctx.storage.delete(registryTokenKey(installationId, userId));
      return new Response(JSON.stringify({ error: 'Registry token expired' }), {
        status: 410,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async deleteRegistryToken(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const installationId = url.searchParams.get('installationId');
    const userId = url.searchParams.get('userId');

    if (!installationId || !userId) {
      return new Response(
        JSON.stringify({
          error: 'installationId and userId parameters are required',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    await this.ctx.storage.delete(registryTokenKey(installationId, userId));

    return new Response(JSON.stringify({ success: true }), {
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

    // Defensive check: ensure userIds is an array
    const userIds = Array.isArray((raw as any).userIds) 
      ? (raw as any).userIds 
      : [];
    
    return { 
      ...raw, 
      userIds: [...userIds],
      lastMigratedAt: (raw as any).lastMigratedAt,
    };
  }

  private async getOrCreateInstallationDirectory(
    installationId: string,
  ): Promise<InstallationDirectoryState> {
    const existing = await this.getInstallationDirectory(installationId);
    if (existing) {
      // Validate the existing directory structure
      if (!Array.isArray(existing.userIds)) {
        console.warn(
          `[WARN] InstallationDirectory for ${installationId} has invalid userIds type`,
          { received: typeof existing.userIds, value: existing.userIds }
        );
        existing.userIds = [];
      }
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
