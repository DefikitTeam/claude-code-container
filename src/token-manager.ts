// Per-user token management system
import { Env, UserConfig, UserInstallationToken } from "./types";
import { generateInstallationToken } from "./github-utils";

/**
 * Token Manager for handling per-user installation tokens with caching
 */
export class TokenManager {
  private env: Env;
  
  constructor(env: Env) {
    this.env = env;
  }

  /**
   * Get a valid installation token for a user
   * Returns cached token if valid, otherwise generates a new one
   */
  async getInstallationToken(userConfig: UserConfig): Promise<string | null> {
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
        console.error(`❌ Failed to generate token for user ${userConfig.userId}`);
        return null;
      }

      // Cache the new token
      await this.cacheToken(userConfig, newToken);
      console.log(`✅ Token generated and cached for user ${userConfig.userId}`);
      return newToken;

    } catch (error) {
      console.error(`Token management error for user ${userConfig.userId}:`, error);
      return null;
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