// Per-user token management system with container registry authentication support
import { Env, UserConfig, UserInstallationToken } from "./types";
import { generateInstallationToken } from "./github-utils";

/**
 * Container Registry Authentication Result
 */
export interface ContainerRegistryAuth {
  token: string;
  expires_at: string;
  registry_url?: string;
}

/**
 * Authentication retry configuration
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  retryCondition?: (error: any) => boolean;
}

/**
 * Token Manager for handling per-user installation tokens with caching and container registry support
 */
export class TokenManager {
  private env: Env;
  private defaultRetryConfig: RetryConfig;
  
  constructor(env: Env, retryConfig?: Partial<RetryConfig>) {
    this.env = env;
    this.defaultRetryConfig = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      retryCondition: (error: any) => {
        // Retry on network errors, timeouts, and temporary server errors
        return error?.message?.includes('network') ||
               error?.message?.includes('timeout') ||
               (error?.status >= 500 && error?.status < 600) ||
               error?.status === 429; // Rate limit
      },
      ...retryConfig
    };
  }

  /**
   * Get a valid installation token for a user with retry logic
   * Returns cached token if valid, otherwise generates a new one
   */
  async getInstallationToken(userConfig: UserConfig, retryConfig?: Partial<RetryConfig>): Promise<string | null> {
    const config = { ...this.defaultRetryConfig, ...retryConfig };
    
    return this.executeWithRetry(async () => {
      try {
        // Try to get cached token first
        const cachedToken = await this.getCachedToken(userConfig.installationId);
        if (cachedToken && !this.isTokenExpired(cachedToken.expiresAt)) {
          console.log(`✅ Using cached token for user ${userConfig.userId}`);
          return cachedToken.token;
        }

        // Generate new token if no valid cached token
        console.log(`🔄 Generating new token for user ${userConfig.userId}`);
        const newToken = await generateInstallationToken(userConfig);
        if (!newToken) {
          throw new Error(`Failed to generate token for user ${userConfig.userId}`);
        }

        // Cache the new token
        await this.cacheToken(userConfig, newToken);
        console.log(`✅ Token generated and cached for user ${userConfig.userId}`);
        return newToken;

      } catch (error) {
        console.error(`Token management error for user ${userConfig.userId}:`, error);
        throw error;
      }
    }, config);
  }

  /**
   * Get container registry authentication for Cloudflare
   * This handles the specific authentication needed for container deployment
   */
  async getContainerRegistryAuth(userConfig: UserConfig): Promise<ContainerRegistryAuth | null> {
    try {
      const installationToken = await this.getInstallationToken(userConfig);
      if (!installationToken) {
        return null;
      }

      // For Cloudflare container registry, we need to authenticate with GitHub token
      // and get a registry-specific token
      const registryAuth = await this.getCloudflareRegistryToken(installationToken, userConfig);
      return registryAuth;
    } catch (error) {
      console.error(`Container registry auth error for user ${userConfig.userId}:`, error);
      return null;
    }
  }

  /**
   * Get Cloudflare container registry token using GitHub installation token
   */
  private async getCloudflareRegistryToken(installationToken: string, userConfig: UserConfig): Promise<ContainerRegistryAuth | null> {
    return this.executeWithRetry(async () => {
      try {
        // Check if we have a cached registry token
        const cachedRegistryToken = await this.getCachedRegistryToken(userConfig.installationId);
        if (cachedRegistryToken && !this.isRegistryTokenExpired(cachedRegistryToken)) {
          console.log(`✅ Using cached registry token for user ${userConfig.userId}`);
          return cachedRegistryToken;
        }

        // Generate new registry token
        console.log(`🔄 Generating new registry token for user ${userConfig.userId}`);
        
        // For now, use the GitHub installation token directly
        // In production, this would involve calling Cloudflare's registry API
        const registryAuth: ContainerRegistryAuth = {
          token: installationToken,
          expires_at: new Date(Date.now() + (50 * 60 * 1000)).toISOString(), // 50 minutes
          registry_url: 'registry.cloudflare.com'
        };

        // Cache the registry token
        await this.cacheRegistryToken(userConfig, registryAuth);
        console.log(`✅ Registry token generated and cached for user ${userConfig.userId}`);
        
        return registryAuth;
      } catch (error) {
        console.error(`Registry token generation error for user ${userConfig.userId}:`, error);
        throw error;
      }
    }, this.defaultRetryConfig);
  }

  /**
   * Validate container registry authentication
   */
  async validateContainerAuth(userConfig: UserConfig): Promise<boolean> {
    try {
      const registryAuth = await this.getContainerRegistryAuth(userConfig);
      if (!registryAuth) {
        return false;
      }

      // Test the authentication by attempting a minimal registry operation
      // For now, we'll just check token format and expiration
      const isValidFormat = registryAuth.token && registryAuth.token.length > 0;
      const isNotExpired = !this.isRegistryTokenExpired(registryAuth);
      
      return isValidFormat && isNotExpired;
    } catch (error) {
      console.error(`Container auth validation error for user ${userConfig.userId}:`, error);
      return false;
    }
  }

  /**
   * Get cached token from Durable Object storage
   */
  private async getCachedToken(installationId: string): Promise<UserInstallationToken | null> {
    try {
      const userConfigDO = this.getUserConfigDO();
      const response = await userConfigDO.fetch(
        new Request(`http://localhost/installation-token?installationId=${installationId}`)
      );

      if (response.ok) {
        return await response.json() as UserInstallationToken;
      }
      
      return null;
    } catch (error) {
      console.error("Error getting cached token:", error);
      return null;
    }
  }

  /**
   * Cache token in Durable Object storage
   */
  private async cacheToken(userConfig: UserConfig, token: string): Promise<void> {
    try {
      const expiresAt = Date.now() + (60 * 60 * 1000); // 1 hour from now
      
      const tokenData: UserInstallationToken = {
        installationId: userConfig.installationId,
        token,
        expiresAt,
        userId: userConfig.userId
      };

      const userConfigDO = this.getUserConfigDO();
      await userConfigDO.fetch(
        new Request("http://localhost/installation-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tokenData),
        })
      );

      console.log(`Token cached for installation ${userConfig.installationId} until ${new Date(expiresAt).toISOString()}`);
    } catch (error) {
      console.error("Error caching token:", error);
    }
  }

  /**
   * Check if token is expired (with 5 minute buffer)
   */
  private isTokenExpired(tokenExpiresAt: number): boolean {
    const now = Date.now();
    const bufferTime = 5 * 60 * 1000; // 5 minutes buffer
    return tokenExpiresAt - now < bufferTime;
  }

  /**
   * Invalidate cached token for a user
   */
  async invalidateToken(installationId: string): Promise<void> {
    try {
      const userConfigDO = this.getUserConfigDO();
      await userConfigDO.fetch(
        new Request(`http://localhost/installation-token?installationId=${installationId}`, {
          method: "DELETE"
        })
      );
      console.log(`Token invalidated for installation ${installationId}`);
    } catch (error) {
      console.error("Error invalidating token:", error);
    }
  }

  /**
   * Get cached registry token from Durable Object storage
   */
  private async getCachedRegistryToken(installationId: string): Promise<ContainerRegistryAuth | null> {
    try {
      const userConfigDO = this.getUserConfigDO();
      const response = await userConfigDO.fetch(
        new Request(`http://localhost/registry-token?installationId=${installationId}`)
      );

      if (response.ok) {
        return await response.json() as ContainerRegistryAuth;
      }
      
      return null;
    } catch (error) {
      console.error("Error getting cached registry token:", error);
      return null;
    }
  }

  /**
   * Cache registry token in Durable Object storage
   */
  private async cacheRegistryToken(userConfig: UserConfig, registryAuth: ContainerRegistryAuth): Promise<void> {
    try {
      const userConfigDO = this.getUserConfigDO();
      await userConfigDO.fetch(
        new Request("http://localhost/registry-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            installationId: userConfig.installationId,
            userId: userConfig.userId,
            ...registryAuth
          }),
        })
      );

      console.log(`Registry token cached for installation ${userConfig.installationId} until ${registryAuth.expires_at}`);
    } catch (error) {
      console.error("Error caching registry token:", error);
    }
  }

  /**
   * Check if registry token is expired (with 5 minute buffer)
   */
  private isRegistryTokenExpired(registryAuth: ContainerRegistryAuth): boolean {
    const now = Date.now();
    const expiresAt = new Date(registryAuth.expires_at).getTime();
    const bufferTime = 5 * 60 * 1000; // 5 minutes buffer
    return expiresAt - now < bufferTime;
  }

  /**
   * Execute function with exponential backoff retry logic
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    config: RetryConfig
  ): Promise<T | null> {
    let lastError: any;
    
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        // Don't retry on the last attempt
        if (attempt === config.maxRetries) {
          break;
        }
        
        // Check if we should retry this error
        if (config.retryCondition && !config.retryCondition(error)) {
          console.log(`Not retrying due to error type: ${error.message}`);
          break;
        }
        
        // Calculate delay with exponential backoff
        const delay = Math.min(
          config.baseDelay * Math.pow(2, attempt),
          config.maxDelay
        );
        
        console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error.message);
        await this.sleep(delay);
      }
    }
    
    console.error(`All retry attempts failed:`, lastError);
    return null;
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Refresh expired tokens for a user
   */
  async refreshUserTokens(userConfig: UserConfig): Promise<boolean> {
    try {
      console.log(`🔄 Refreshing tokens for user ${userConfig.userId}`);
      
      // Invalidate cached tokens
      await this.invalidateToken(userConfig.installationId);
      await this.invalidateRegistryToken(userConfig.installationId);
      
      // Generate fresh tokens
      const newInstallationToken = await this.getInstallationToken(userConfig);
      if (!newInstallationToken) {
        console.error(`❌ Failed to refresh installation token for user ${userConfig.userId}`);
        return false;
      }
      
      const newRegistryAuth = await this.getContainerRegistryAuth(userConfig);
      if (!newRegistryAuth) {
        console.error(`❌ Failed to refresh registry auth for user ${userConfig.userId}`);
        return false;
      }
      
      console.log(`✅ Tokens refreshed successfully for user ${userConfig.userId}`);
      return true;
    } catch (error) {
      console.error(`Token refresh error for user ${userConfig.userId}:`, error);
      return false;
    }
  }

  /**
   * Invalidate cached registry token for a user
   */
  async invalidateRegistryToken(installationId: string): Promise<void> {
    try {
      const userConfigDO = this.getUserConfigDO();
      await userConfigDO.fetch(
        new Request(`http://localhost/registry-token?installationId=${installationId}`, {
          method: "DELETE"
        })
      );
      console.log(`Registry token invalidated for installation ${installationId}`);
    } catch (error) {
      console.error("Error invalidating registry token:", error);
    }
  }

  /**
   * Get UserConfigDO instance
   */
  private getUserConfigDO() {
    const id = this.env.USER_CONFIG.idFromName("user-config");
    return this.env.USER_CONFIG.get(id);
  }
}

/**
 * Get a TokenManager instance
 */
export function getTokenManager(env: Env): TokenManager {
  return new TokenManager(env);
}