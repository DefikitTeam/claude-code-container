/**
 * Token Service Interface
 * Defines contract for GitHub installation token management
 */

export interface ITokenService {
  /**
   * Get or refresh installation token
   */
  getInstallationToken(installationId: string): Promise<{
    token: string;
    expiresAt: number;
  }>;

  /**
   * Invalidate cached token
   */
  invalidateToken(installationId: string): Promise<void>;

  /**
   * Check if token is still valid
   */
  isTokenValid(installationId: string, expiresAt: number): boolean;
}
