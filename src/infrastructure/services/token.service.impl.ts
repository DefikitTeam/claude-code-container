/**
 * Token Service Implementation
 * Manages GitHub installation tokens with caching and validation
 *
 * Implements: ITokenService
 *
 * IMPORTANT: This service NO LONGER generates tokens using GitHub App credentials.
 * Instead, it calls an external token provider API (e.g., LumiLink backend) which
 * securely manages GitHub App credentials and generates tokens server-side.
 */

import { ITokenService } from '../../core/interfaces/services/token.service';
import { ValidationError } from '../../shared/errors/validation.error';

export interface TokenCache {
  token: string;
  expiresAt: number;
  refreshedAt: number;
}

/**
 * External token provider interface
 * Implement this to call your platform's token generation API
 */
export interface ExternalTokenProvider {
  /**
   * Get installation token from external API
   * @param installationId - GitHub installation ID
   * @returns Token and expiration timestamp
   */
  getToken(
    installationId: string,
  ): Promise<{ token: string; expiresAt: number }>;
}

/**
 * Token Service Implementation
 * Handles token retrieval, caching, and validation
 */
export class TokenServiceImpl implements ITokenService {
  /**
   * Token cache: installationId -> TokenCache
   * In production, this would be backed by Durable Object storage
   */
  private tokenCache: Map<string, TokenCache> = new Map();

  /**
   * Time buffer before token expiry (5 minutes)
   * Tokens are considered expired if less than this time remains
   */
  private readonly TOKEN_EXPIRY_BUFFER = 5 * 60 * 1000;

  /**
   * @param externalProvider - External token provider (e.g., LumiLink API client)
   */
  // Accept either an ExternalTokenProvider object or a function that returns a token
  constructor(
    private externalProvider?:
      | ExternalTokenProvider
      | ((installationId: string) => Promise<{ token: string; expiresAt: number }>),
  ) {}

  /**
   * Get or refresh installation token
   * Returns cached token if valid, otherwise fetches from external provider
   *
   * @param installationId - GitHub installation ID
   * @returns Token and expiration time
   * @throws ValidationError if installationId is invalid or provider not configured
   */
  async getInstallationToken(installationId: string): Promise<{
    token: string;
    expiresAt: number;
  }> {
    if (!installationId || typeof installationId !== 'string') {
      throw new ValidationError('installationId must be a non-empty string');
    }

    // Try to get cached token
    const cachedToken = this.tokenCache.get(installationId);
    if (
      cachedToken &&
      this.isTokenValid(installationId, cachedToken.expiresAt)
    ) {
      return {
        token: cachedToken.token,
        expiresAt: cachedToken.expiresAt,
      };
    }

    // Fetch new token from external provider
    if (!this.externalProvider) {
      throw new ValidationError('External token provider not configured');
    }

    let tokenResponse: { token: string; expiresAt: number };
    if (typeof this.externalProvider === 'function') {
      const maybeToken = await this.externalProvider(installationId);
      if (typeof maybeToken === 'string') {
        // Backward-compat: provider returned only token string
        tokenResponse = { token: maybeToken, expiresAt: Date.now() + 60 * 60 * 1000 };
      } else {
        tokenResponse = maybeToken;
      }
    } else {
      tokenResponse = await this.externalProvider.getToken(installationId);
    }

    const { token, expiresAt } = tokenResponse;

    // Cache the token
    this.tokenCache.set(installationId, {
      token,
      expiresAt,
      refreshedAt: Date.now(),
    });

    return { token, expiresAt };
  }

  /**
   * Invalidate cached token
   *
   * @param installationId - GitHub installation ID
   */
  async invalidateToken(installationId: string): Promise<void> {
    if (!installationId || typeof installationId !== 'string') {
      throw new ValidationError('installationId must be a non-empty string');
    }

    this.tokenCache.delete(installationId);
  }

  /**
   * Check if token is still valid
   * Accounts for expiry buffer to prevent using tokens that are about to expire
   *
   * @param installationId - GitHub installation ID
   * @param expiresAt - Token expiration timestamp
   * @returns True if token is valid and not about to expire
   */
  isTokenValid(installationId: string, expiresAt: number): boolean {
    if (!installationId || typeof installationId !== 'string') {
      return false;
    }

    if (typeof expiresAt !== 'number' || expiresAt <= 0) {
      return false;
    }

    const now = Date.now();
    const timeRemaining = expiresAt - now;

    return timeRemaining > this.TOKEN_EXPIRY_BUFFER;
  }

  /**
   * Clear all cached tokens
   * Useful for testing or when resetting state
   */
  clearCache(): void {
    this.tokenCache.clear();
  }

  /**
   * Get cache statistics (useful for monitoring)
   */
  getCacheStats(): {
    totalCached: number;
    installations: string[];
  } {
    return {
      totalCached: this.tokenCache.size,
      installations: Array.from(this.tokenCache.keys()),
    };
  }

  /**
   * Refresh expired tokens for all cached installations
   * Called periodically to maintain valid tokens
   */
  async refreshExpiredTokens(): Promise<number> {
    let refreshed = 0;

    for (const [installationId, cached] of this.tokenCache.entries()) {
      if (!this.isTokenValid(installationId, cached.expiresAt)) {
        try {
          await this.invalidateToken(installationId);
          refreshed++;
        } catch (error) {
          console.error(
            `Failed to refresh token for installation ${installationId}:`,
            error,
          );
        }
      }
    }

    return refreshed;
  }
}
