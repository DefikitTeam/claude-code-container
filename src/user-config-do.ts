// Durable Object for managing multi-tenant user configurations
import { DurableObject } from "cloudflare:workers";
import { CryptoUtils } from "./crypto";
import { UserConfig, StoredUserConfig, UserInstallationToken } from "./types";

export class UserConfigDO extends DurableObject {
  private crypto: CryptoUtils;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.crypto = new CryptoUtils();
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
        case "POST /register":
          return this.registerUser(request);
        case "GET /user":
          return this.getUser(request);
        case "PUT /user":
          return this.updateUser(request);
        case "DELETE /user":
          return this.deleteUser(request);
        case "GET /user-by-installation":
          return this.getUserByInstallation(request);
        case "POST /installation-token":
          return this.storeInstallationToken(request);
        case "GET /installation-token":
          return this.getInstallationToken(request);
        case "GET /users":
          return this.listUsers();
        default:
          return new Response("Not Found", { status: 404 });
      }
    } catch (error) {
      console.error("UserConfigDO error:", error);
      return new Response(
        JSON.stringify({
          error: "Internal error",
          message: error instanceof Error ? error.message : "Unknown error"
        }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  /**
   * Register a new user with their Installation ID and Anthropic API key
   */
  private async registerUser(request: Request): Promise<Response> {
    const data = await request.json() as {
      installationId: string;
      anthropicApiKey: string;
      userId?: string;
    };

    if (!data.installationId || !data.anthropicApiKey) {
      return new Response(
        JSON.stringify({ error: "installationId and anthropicApiKey are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Generate userId if not provided
    const userId = data.userId || `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Check if installation ID is already registered
    const existingUser = await this.findUserByInstallationId(data.installationId);
    if (existingUser) {
      return new Response(
        JSON.stringify({ 
          error: "Installation ID already registered",
          existingUserId: existingUser.userId
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      );
    }

    // Encrypt the Anthropic API key
    const encryptedApiKey = await this.crypto.encrypt(data.anthropicApiKey);

    const userConfig: StoredUserConfig = {
      userId,
      installationId: data.installationId,
      encryptedAnthropicApiKey: encryptedApiKey,
      repositoryAccess: [], // Will be populated when we fetch from GitHub
      created: Date.now(),
      updated: Date.now(),
      isActive: true
    };

    // Store the user configuration
    await this.ctx.storage.put(`user:${userId}`, userConfig);
    await this.ctx.storage.put(`installation:${data.installationId}`, userId);

    console.log(`✅ Registered new user: ${userId} with installation: ${data.installationId}`);

    return new Response(
      JSON.stringify({
        success: true,
        userId,
        installationId: data.installationId,
        message: "User registered successfully"
      }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  }

  /**
   * Get user configuration by userId
   */
  private async getUser(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "userId parameter is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const storedConfig = await this.ctx.storage.get<StoredUserConfig>(`user:${userId}`);
    if (!storedConfig) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Decrypt the Anthropic API key
    const anthropicApiKey = await this.crypto.decrypt(storedConfig.encryptedAnthropicApiKey);

    const userConfig: UserConfig = {
      userId: storedConfig.userId,
      installationId: storedConfig.installationId,
      anthropicApiKey,
      repositoryAccess: storedConfig.repositoryAccess,
      created: storedConfig.created,
      updated: storedConfig.updated,
      isActive: storedConfig.isActive
    };

    return new Response(
      JSON.stringify(userConfig),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  /**
   * Get user configuration by Installation ID
   */
  private async getUserByInstallation(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const installationId = url.searchParams.get("installationId");

    if (!installationId) {
      return new Response(
        JSON.stringify({ error: "installationId parameter is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const userConfig = await this.findUserByInstallationId(installationId);
    if (!userConfig) {
      return new Response(
        JSON.stringify({ error: "User not found for installation ID" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify(userConfig),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  /**
   * Update user configuration
   */
  private async updateUser(request: Request): Promise<Response> {
    const data = await request.json() as {
      userId: string;
      anthropicApiKey?: string;
      repositoryAccess?: string[];
      isActive?: boolean;
    };

    if (!data.userId) {
      return new Response(
        JSON.stringify({ error: "userId is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const storedConfig = await this.ctx.storage.get<StoredUserConfig>(`user:${data.userId}`);
    if (!storedConfig) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Update fields if provided
    const updatedConfig: StoredUserConfig = {
      ...storedConfig,
      updated: Date.now()
    };

    if (data.anthropicApiKey) {
      updatedConfig.encryptedAnthropicApiKey = await this.crypto.encrypt(data.anthropicApiKey);
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
        message: "User updated successfully"
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  /**
   * Delete user configuration
   */
  private async deleteUser(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "userId parameter is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const storedConfig = await this.ctx.storage.get<StoredUserConfig>(`user:${userId}`);
    if (!storedConfig) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Remove user and installation mapping
    await this.ctx.storage.delete(`user:${userId}`);
    await this.ctx.storage.delete(`installation:${storedConfig.installationId}`);

    // Remove any cached installation tokens
    const tokenKey = `token:${storedConfig.installationId}`;
    await this.ctx.storage.delete(tokenKey);

    return new Response(
      JSON.stringify({
        success: true,
        message: "User deleted successfully"
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  /**
   * Store installation access token with expiry
   */
  private async storeInstallationToken(request: Request): Promise<Response> {
    const data = await request.json() as {
      installationId: string;
      token: string;
      expiresAt: number;
      userId: string;
    };

    const tokenData: UserInstallationToken = {
      installationId: data.installationId,
      token: data.token,
      expiresAt: data.expiresAt,
      userId: data.userId
    };

    await this.ctx.storage.put(`token:${data.installationId}`, tokenData);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  /**
   * Get cached installation access token
   */
  private async getInstallationToken(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const installationId = url.searchParams.get("installationId");

    if (!installationId) {
      return new Response(
        JSON.stringify({ error: "installationId parameter is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const tokenData = await this.ctx.storage.get<UserInstallationToken>(`token:${installationId}`);
    if (!tokenData) {
      return new Response(
        JSON.stringify({ error: "Token not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Check if token is expired (with 5 minute buffer)
    const now = Date.now();
    const bufferTime = 5 * 60 * 1000; // 5 minutes
    if (tokenData.expiresAt - now < bufferTime) {
      await this.ctx.storage.delete(`token:${installationId}`);
      return new Response(
        JSON.stringify({ error: "Token expired" }),
        { status: 410, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify(tokenData),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  /**
   * List all users (admin endpoint)
   */
  private async listUsers(): Promise<Response> {
    const users: UserConfig[] = [];
    const userMap = await this.ctx.storage.list({ prefix: "user:" });

    for (const [key, storedConfig] of userMap) {
      if (typeof storedConfig === 'object' && storedConfig !== null) {
        const config = storedConfig as StoredUserConfig;
        try {
          const anthropicApiKey = await this.crypto.decrypt(config.encryptedAnthropicApiKey);
          users.push({
            userId: config.userId,
            installationId: config.installationId,
            anthropicApiKey: "***REDACTED***", // Don't return actual API key in list
            repositoryAccess: config.repositoryAccess,
            created: config.created,
            updated: config.updated,
            isActive: config.isActive
          });
        } catch (error) {
          console.error(`Failed to decrypt API key for user ${config.userId}:`, error);
        }
      }
    }

    return new Response(
      JSON.stringify({ users, count: users.length }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  /**
   * Helper method to find user by installation ID
   */
  private async findUserByInstallationId(installationId: string): Promise<UserConfig | null> {
    const userId = await this.ctx.storage.get<string>(`installation:${installationId}`);
    if (!userId) return null;

    const storedConfig = await this.ctx.storage.get<StoredUserConfig>(`user:${userId}`);
    if (!storedConfig) return null;

    try {
      const anthropicApiKey = await this.crypto.decrypt(storedConfig.encryptedAnthropicApiKey);
      return {
        userId: storedConfig.userId,
        installationId: storedConfig.installationId,
        anthropicApiKey,
        repositoryAccess: storedConfig.repositoryAccess,
        created: storedConfig.created,
        updated: storedConfig.updated,
        isActive: storedConfig.isActive
      };
    } catch (error) {
      console.error(`Failed to decrypt API key for user ${storedConfig.userId}:`, error);
      return null;
    }
  }
}