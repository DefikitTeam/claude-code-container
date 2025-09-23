// Container registry authentication specifically for Cloudflare deployments
import type { Env, UserConfig } from './types';
import { TokenManager, ContainerRegistryAuth } from './token-manager';
import { getTokenManager } from './token-manager';

/**
 * Container deployment authentication result
 */
export interface DeploymentAuth {
  registryToken: string;
  registryUrl: string;
  expiresAt: string;
  deploymentHeaders: Record<string, string>;
}

/**
 * Container registry authentication error types
 */
export enum ContainerAuthError {
  TOKEN_GENERATION_FAILED = 'TOKEN_GENERATION_FAILED',
  REGISTRY_ACCESS_DENIED = 'REGISTRY_ACCESS_DENIED',
  CLOUDFLARE_API_ERROR = 'CLOUDFLARE_API_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
}

/**
 * Container registry authentication result with error details
 */
export interface ContainerAuthResult {
  success: boolean;
  auth?: DeploymentAuth;
  error?: ContainerAuthError;
  message?: string;
  retryable?: boolean;
}

/**
 * Container Registry Authentication Manager
 * Handles Cloudflare-specific container deployment authentication
 */
export class ContainerRegistryAuthManager {
  private tokenManager: TokenManager;
  private env: Env;

  constructor(env: Env) {
    this.env = env;
    this.tokenManager = getTokenManager(env);
  }

  /**
   * Get authentication for container deployment to Cloudflare
   */
  async getDeploymentAuth(
    userConfig: UserConfig,
  ): Promise<ContainerAuthResult> {
    try {
      console.log(`🔐 Getting deployment auth for user ${userConfig.userId}`);

      // Get container registry authentication
      const registryAuth =
        await this.tokenManager.getContainerRegistryAuth(userConfig);
      if (!registryAuth) {
        return {
          success: false,
          error: ContainerAuthError.TOKEN_GENERATION_FAILED,
          message: 'Failed to generate container registry authentication',
          retryable: true,
        };
      }

      // Validate the authentication
      const isValid = await this.validateRegistryAuth(registryAuth);
      if (!isValid) {
        return {
          success: false,
          error: ContainerAuthError.VALIDATION_FAILED,
          message: 'Registry authentication validation failed',
          retryable: true,
        };
      }

      // Create deployment headers
      const deploymentHeaders = this.createDeploymentHeaders(registryAuth);

      const deploymentAuth: DeploymentAuth = {
        registryToken: registryAuth.token,
        registryUrl: registryAuth.registry_url || 'registry.cloudflare.com',
        expiresAt: registryAuth.expires_at,
        deploymentHeaders,
      };

      console.log(
        `✅ Deployment auth successful for user ${userConfig.userId}`,
      );
      return {
        success: true,
        auth: deploymentAuth,
      };
    } catch (error) {
      console.error(
        `Container deployment auth error for user ${userConfig.userId}:`,
        error,
      );

      return {
        success: false,
        error: this.categorizeError(error),
        message: error instanceof Error ? error.message : 'Unknown error',
        retryable: this.isRetryableError(error),
      };
    }
  }

  /**
   * Validate registry authentication by testing access
   */
  private async validateRegistryAuth(
    registryAuth: ContainerRegistryAuth,
  ): Promise<boolean> {
    try {
      // For Cloudflare registry, we can test authentication by attempting to list repositories
      // or by calling a minimal API endpoint
      const testUrl = `https://${registryAuth.registry_url || 'registry.cloudflare.com'}/v2/`;

      const response = await fetch(testUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${registryAuth.token}`,
          Accept: 'application/json',
          'User-Agent': 'claude-code-containers/1.0.0',
        },
      });

      // Registry should return 200 for authenticated requests or 401 for unauthorized
      // A 401 means the endpoint works but auth failed
      // A 404 or other errors might mean network issues
      if (response.status === 200) {
        console.log('✅ Registry authentication validated successfully');
        return true;
      } else if (response.status === 401) {
        console.log(
          '❌ Registry authentication validation failed - unauthorized',
        );
        return false;
      } else {
        console.log(
          `⚠️  Registry validation inconclusive - status: ${response.status}`,
        );
        // For non-200/401 responses, we'll assume auth is OK but registry might be having issues
        return true;
      }
    } catch (error) {
      console.error('Registry validation error:', error);
      // Network errors don't necessarily mean auth is invalid
      return true;
    }
  }

  /**
   * Create deployment headers for Cloudflare container deployment
   */
  private createDeploymentHeaders(
    registryAuth: ContainerRegistryAuth,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${registryAuth.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'claude-code-containers/1.0.0',
    };

    // Add Cloudflare-specific headers if needed
    if (registryAuth.registry_url?.includes('cloudflare.com')) {
      headers['CF-Access-Client-Id'] = registryAuth.token;
      headers['X-Registry-Config'] = 'cloudflare-workers';
    }

    return headers;
  }

  /**
   * Categorize error for appropriate handling
   */
  private categorizeError(error: any): ContainerAuthError {
    if (error?.message?.toLowerCase().includes('network')) {
      return ContainerAuthError.NETWORK_ERROR;
    }

    if (error?.status === 401 || error?.status === 403) {
      return ContainerAuthError.REGISTRY_ACCESS_DENIED;
    }

    if (error?.message?.toLowerCase().includes('cloudflare')) {
      return ContainerAuthError.CLOUDFLARE_API_ERROR;
    }

    if (
      error?.message?.toLowerCase().includes('token') ||
      error?.message?.toLowerCase().includes('auth')
    ) {
      return ContainerAuthError.TOKEN_GENERATION_FAILED;
    }

    return ContainerAuthError.VALIDATION_FAILED;
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(error: any): boolean {
    const retryableErrors = [
      ContainerAuthError.NETWORK_ERROR,
      ContainerAuthError.TOKEN_GENERATION_FAILED,
      ContainerAuthError.CLOUDFLARE_API_ERROR,
    ];

    const errorType = this.categorizeError(error);
    return retryableErrors.includes(errorType);
  }

  /**
   * Refresh authentication for a user
   */
  async refreshAuth(userConfig: UserConfig): Promise<ContainerAuthResult> {
    try {
      console.log(`🔄 Refreshing container auth for user ${userConfig.userId}`);

      // Refresh tokens through token manager
      const refreshSuccess =
        await this.tokenManager.refreshUserTokens(userConfig);
      if (!refreshSuccess) {
        return {
          success: false,
          error: ContainerAuthError.TOKEN_GENERATION_FAILED,
          message: 'Failed to refresh user tokens',
          retryable: true,
        };
      }

      // Get new authentication
      return await this.getDeploymentAuth(userConfig);
    } catch (error) {
      console.error(`Auth refresh error for user ${userConfig.userId}:`, error);
      return {
        success: false,
        error: this.categorizeError(error),
        message: error instanceof Error ? error.message : 'Refresh failed',
        retryable: false,
      };
    }
  }

  /**
   * Pre-validate authentication before deployment
   */
  async preValidateAuth(userConfig: UserConfig): Promise<ContainerAuthResult> {
    console.log(
      `🔍 Pre-validating container auth for user ${userConfig.userId}`,
    );

    // First check if we can get auth
    const authResult = await this.getDeploymentAuth(userConfig);
    if (!authResult.success) {
      return authResult;
    }

    // Additional validation specific to deployment
    const deploymentAuth = authResult.auth!;

    // Check if token is close to expiry (within 10 minutes)
    const expiresAt = new Date(deploymentAuth.expiresAt).getTime();
    const now = Date.now();
    const tenMinutes = 10 * 60 * 1000;

    if (expiresAt - now < tenMinutes) {
      console.log(
        `⚠️  Auth token expires soon for user ${userConfig.userId}, refreshing`,
      );
      return await this.refreshAuth(userConfig);
    }

    console.log(`✅ Pre-validation successful for user ${userConfig.userId}`);
    return authResult;
  }

  /**
   * Handle authentication failure during deployment
   */
  async handleDeploymentAuthFailure(
    userConfig: UserConfig,
    error: any,
  ): Promise<ContainerAuthResult> {
    console.log(
      `🚨 Handling deployment auth failure for user ${userConfig.userId}:`,
      error,
    );

    const errorType = this.categorizeError(error);

    if (!this.isRetryableError(error)) {
      return {
        success: false,
        error: errorType,
        message: 'Non-retryable authentication error',
        retryable: false,
      };
    }

    // Attempt to refresh authentication
    return await this.refreshAuth(userConfig);
  }
}

/**
 * Get a ContainerRegistryAuthManager instance
 */
export function getContainerRegistryAuthManager(
  env: Env,
): ContainerRegistryAuthManager {
  return new ContainerRegistryAuthManager(env);
}

/**
 * Quick auth validation for middleware use
 */
export async function validateContainerAuth(
  env: Env,
  userConfig: UserConfig,
): Promise<boolean> {
  try {
    const authManager = getContainerRegistryAuthManager(env);
    const result = await authManager.getDeploymentAuth(userConfig);
    return result.success;
  } catch (error) {
    console.error('Quick auth validation failed:', error);
    return false;
  }
}
