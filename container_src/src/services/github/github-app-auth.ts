/**
 * GitHub App Authentication Service
 * Generates installation access tokens from GitHub App credentials
 */

import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

export interface GitHubAppCredentials {
  appId: string | number;
  privateKey: string;
}

export interface InstallationTokenResult {
  token: string;
  expiresAt: string;
}

/**
 * Cache for installation tokens to avoid regenerating them frequently
 */
const tokenCache = new Map<string, { token: string; expiresAt: Date }>();

export class GitHubAppAuthService {
  private appId: number;
  private privateKey: string;

  constructor(credentials: GitHubAppCredentials) {
    this.appId = typeof credentials.appId === 'string'
      ? parseInt(credentials.appId, 10)
      : credentials.appId;
    this.privateKey = credentials.privateKey;
  }

  /**
   * Get an installation access token for a specific installation
   * Uses cached token if still valid, otherwise generates a new one
   */
  async getInstallationToken(installationId: string | number): Promise<string> {
    const installationIdNum = typeof installationId === 'string'
      ? parseInt(installationId, 10)
      : installationId;

    const cacheKey = `installation-${installationIdNum}`;

    // Check cache
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
      // Token valid for at least 5 more minutes
      console.error(`[GITHUB-APP-AUTH] Using cached token for installation ${installationIdNum}`);
      return cached.token;
    }

    // Generate new token
    console.error(`[GITHUB-APP-AUTH] Generating new token for installation ${installationIdNum}`);

    try {
      const auth = createAppAuth({
        appId: this.appId,
        privateKey: this.privateKey,
      });

      const installationAuth = await auth({
        type: 'installation',
        installationId: installationIdNum,
      });

      const token = installationAuth.token;
      const expiresAt = installationAuth.expiresAt
        ? new Date(installationAuth.expiresAt)
        : new Date(Date.now() + 60 * 60 * 1000); // Default 1 hour

      // Cache the token
      tokenCache.set(cacheKey, { token, expiresAt });

      console.error(`[GITHUB-APP-AUTH] Token generated successfully, expires at ${expiresAt.toISOString()}`);

      return token;
    } catch (error) {
      console.error(`[GITHUB-APP-AUTH] Failed to generate token:`, error instanceof Error ? error.message : String(error));
      throw new Error(`Failed to generate installation token: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get an Octokit instance authenticated as the installation
   */
  async getInstallationOctokit(installationId: string | number): Promise<Octokit> {
    const token = await this.getInstallationToken(installationId);
    return new Octokit({
      auth: token,
      userAgent: 'claude-code-container/1.0.0',
    });
  }

  /**
   * Clear cached token for an installation (useful after errors)
   */
  clearTokenCache(installationId: string | number): void {
    const installationIdNum = typeof installationId === 'string'
      ? parseInt(installationId, 10)
      : installationId;
    const cacheKey = `installation-${installationIdNum}`;
    tokenCache.delete(cacheKey);
    console.error(`[GITHUB-APP-AUTH] Cleared cached token for installation ${installationIdNum}`);
  }

  /**
   * Clear all cached tokens
   */
  clearAllTokens(): void {
    tokenCache.clear();
    console.error(`[GITHUB-APP-AUTH] Cleared all cached tokens`);
  }
}

/**
 * Create a GitHub App Auth Service from environment variables
 */
export function createGitHubAppAuthFromEnv(): GitHubAppAuthService | null {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!appId || !privateKey) {
    console.error('[GITHUB-APP-AUTH] Missing GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY');
    return null;
  }

  console.error(`[GITHUB-APP-AUTH] Initialized with App ID: ${appId}`);

  return new GitHubAppAuthService({
    appId,
    privateKey,
  });
}

/**
 * Singleton instance for the app
 */
let globalAuthService: GitHubAppAuthService | null = null;

export function getGlobalGitHubAppAuth(): GitHubAppAuthService | null {
  if (!globalAuthService) {
    globalAuthService = createGitHubAppAuthFromEnv();
  }
  return globalAuthService;
}
