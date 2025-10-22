/**
 * Token Service Implementation
 * Manages GitHub installation tokens with caching and validation
 *
 * Implements: ITokenService
 */

import { ITokenService } from '../../core/interfaces/services/token.service';
import { ValidationError } from '../../shared/errors/validation.error';

export interface TokenCache {
  token: string;
  expiresAt: number;
  refreshedAt: number;
}

/**
 * Token Service Implementation
 * Handles token generation, caching, and validation
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
   * Token TTL (1 hour) - GitHub installation tokens last 1 hour
   */
  private readonly TOKEN_TTL = 60 * 60 * 1000;

  constructor(private githubTokenGenerator?: (installationId: string) => Promise<string>) {}

  /**
   * Get or refresh installation token
   * Returns cached token if valid, otherwise generates new one
   *
   * @param installationId - GitHub installation ID
   * @returns Token and expiration time
   * @throws ValidationError if installationId is invalid
   */
  async getInstallationToken(
    installationId: string,
  ): Promise<{
    token: string;
    expiresAt: number;
  }> {
    if (!installationId || typeof installationId !== 'string') {
      throw new ValidationError('installationId must be a non-empty string');
    }

    // Try to get cached token
    const cachedToken = this.tokenCache.get(installationId);
    if (cachedToken && this.isTokenValid(installationId, cachedToken.expiresAt)) {
      return {
        token: cachedToken.token,
        expiresAt: cachedToken.expiresAt,
      };
    }

    // Generate new token
    let token: string;
    if (this.githubTokenGenerator) {
      token = await this.githubTokenGenerator(installationId);
    } else {
      throw new ValidationError('Token generator not configured');
    }

    // Cache the token
    const expiresAt = Date.now() + this.TOKEN_TTL;
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
          console.error(`Failed to refresh token for installation ${installationId}:`, error);
        }
      }
    }

    return refreshed;
  }
}
