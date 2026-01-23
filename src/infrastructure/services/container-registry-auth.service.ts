/**
 * Container Registry Authentication Service
 * Handles Cloudflare-specific container deployment authentication
 * Ported from src/container-registry-auth.ts
 */

import { UserConfig, Env } from '../../shared/types/index';
import { ITokenService } from '../../core/interfaces/services/token.service';
export interface DeploymentAuth {
  registryToken: string;
  registryUrl: string;
  expiresAt: string;
  deploymentHeaders: Record<string, string>;
}

export enum ContainerAuthError {
  TOKEN_GENERATION_FAILED = 'TOKEN_GENERATION_FAILED',
  REGISTRY_ACCESS_DENIED = 'REGISTRY_ACCESS_DENIED',
  CLOUDFLARE_API_ERROR = 'CLOUDFLARE_API_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
}

export interface ContainerAuthResult {
  success: boolean;
  auth?: DeploymentAuth;
  error?: ContainerAuthError;
  message?: string;
  retryable?: boolean;
}

export interface ContainerRegistryAuth {
  token: string;
  registry_url?: string;
  expires_at: string;
}

/**
 * Container Registry Authentication Service Interface
 */
export interface IContainerRegistryAuthService {
  getDeploymentAuth(userConfig: UserConfig): Promise<ContainerAuthResult>;
  refreshAuth(userConfig: UserConfig): Promise<ContainerAuthResult>;
  preValidateAuth(userConfig: UserConfig): Promise<ContainerAuthResult>;
  handleDeploymentAuthFailure(
    userConfig: UserConfig,
    error: unknown,
  ): Promise<ContainerAuthResult>;
}

/**
 * Container Registry Authentication Service Implementation
 */
export class ContainerRegistryAuthService
  implements IContainerRegistryAuthService
{
  constructor(
    private readonly env: Env,
    private readonly tokenService: ITokenService,
  ) {}

  /**
   * Get authentication for container deployment to Cloudflare
   */
  async getDeploymentAuth(userConfig: UserConfig): Promise<ContainerAuthResult> {
    try {
      console.log(`🔐 Getting deployment auth for user ${userConfig.userId}`);

      // Get container registry authentication from token service
      const registryAuth = await this.getContainerRegistryAuth(userConfig);
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
   * Get container registry auth token (simulated for now)
   */
  private async getContainerRegistryAuth(
    userConfig: UserConfig,
  ): Promise<ContainerRegistryAuth | null> {
    try {
      // In a real implementation, this would call Cloudflare API to get registry token
      // For now, return a simulated token structure
      return {
        token: `cf_registry_token_${userConfig.userId}_${Date.now()}`,
        registry_url: 'registry.cloudflare.com',
        expires_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
      };
    } catch (error) {
      console.error('Failed to get container registry auth:', error);
      return null;
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
      const testUrl = `https://${registryAuth.registry_url || 'registry.cloudflare.com'}/v2/`;

      const response = await fetch(testUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${registryAuth.token}`,
          Accept: 'application/json',
          'User-Agent': 'claude-code-containers/1.0.0',
        },
      });

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
        // For non-200/401 responses, assume auth is OK but registry might be having issues
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
  private categorizeError(error: unknown): ContainerAuthError {
    const err = error as { message?: string; status?: number };
    if (err?.message?.toLowerCase().includes('network')) {
      return ContainerAuthError.NETWORK_ERROR;
    }

    if (err?.status === 401 || err?.status === 403) {
      return ContainerAuthError.REGISTRY_ACCESS_DENIED;
    }

    if (err?.message?.toLowerCase().includes('cloudflare')) {
      return ContainerAuthError.CLOUDFLARE_API_ERROR;
    }

    if (
      err?.message?.toLowerCase().includes('token') ||
      err?.message?.toLowerCase().includes('auth')
    ) {
      return ContainerAuthError.TOKEN_GENERATION_FAILED;
    }

    return ContainerAuthError.VALIDATION_FAILED;
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
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

      // In real implementation, would refresh tokens through token service
      // For now, just get new auth
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
    error: unknown,
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
