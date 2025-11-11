import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { TokenManager } from '../../src/token-manager';
import { generateInstallationToken } from '../../src/github-utils';
import type { Env, UserConfig, UserInstallationToken } from '../../src/types';

// Mock the github-utils module
vi.mock('../../src/github-utils', () => ({
  generateInstallationToken: vi.fn(),
}));

describe('TokenManager', () => {
  let tokenManager: TokenManager;
  let mockEnv: Env;
  let mockUserConfig: UserConfig;
  let mockDurableObject: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock Durable Object
    mockDurableObject = {
      fetch: vi.fn(),
    };

    // Mock environment
    mockEnv = {
      MY_CONTAINER: {} as any,
      GITHUB_APP_CONFIG: {} as any,
      USER_CONFIG: {
        idFromName: vi.fn(() => 'mock-id'),
        get: vi.fn(() => mockDurableObject),
      } as any,
      ACP_SESSION: {} as any,
      ANTHROPIC_API_KEY: 'test-key',
    };

    // Mock user config
    mockUserConfig = {
      userId: 'test-user-123',
      installationId: '12345',
      anthropicApiKey: 'test-anthropic-key',
      repositoryAccess: ['owner/repo'],
      created: Date.now(),
      updated: Date.now(),
      isActive: true,
    };

    tokenManager = new TokenManager(mockEnv);
  });

  describe('getInstallationToken', () => {
    it('should return cached token when valid', async () => {
      const validToken: UserInstallationToken = {
        installationId: '12345',
        token: 'cached-token-123',
        expiresAt: Date.now() + 3600000, // 1 hour from now
        userId: 'test-user-123',
      };

      // Mock successful cached token retrieval
      mockDurableObject.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(validToken),
      });

      const result = await tokenManager.getInstallationToken(mockUserConfig);

      expect(result).toBe('cached-token-123');
      expect(generateInstallationToken).not.toHaveBeenCalled();
    });

    it('should generate new token when cached token is expired', async () => {
      const expiredToken: UserInstallationToken = {
        installationId: '12345',
        token: 'expired-token',
        expiresAt: Date.now() - 1000, // Expired 1 second ago
        userId: 'test-user-123',
      };

      // Mock expired cached token retrieval
      mockDurableObject.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(expiredToken),
      });

      // Mock successful token caching
      mockDurableObject.fetch.mockResolvedValueOnce({
        ok: true,
      });

      // Mock new token generation
      (generateInstallationToken as Mock).mockResolvedValue('new-token-456');

      const result = await tokenManager.getInstallationToken(mockUserConfig);

      expect(result).toBe('new-token-456');
      expect(generateInstallationToken).toHaveBeenCalledWith(
        mockUserConfig,
        mockEnv,
      );
    });

    it('should generate new token when no cached token exists', async () => {
      // Mock no cached token
      mockDurableObject.fetch.mockResolvedValueOnce({
        ok: false,
      });

      // Mock successful token caching
      mockDurableObject.fetch.mockResolvedValueOnce({
        ok: true,
      });

      // Mock new token generation
      (generateInstallationToken as Mock).mockResolvedValue('new-token-789');

      const result = await tokenManager.getInstallationToken(mockUserConfig);

      expect(result).toBe('new-token-789');
      expect(generateInstallationToken).toHaveBeenCalledWith(
        mockUserConfig,
        mockEnv,
      );
    });

    it('should generate new token when cached token endpoint reports expiration', async () => {
      mockDurableObject.fetch.mockResolvedValueOnce({
        ok: false,
        status: 410,
        json: () => Promise.resolve({ error: 'Token expired' }),
      });

      mockDurableObject.fetch.mockResolvedValueOnce({
        ok: true,
      });

      (generateInstallationToken as Mock).mockResolvedValue(
        'new-token-expired',
      );

      const result = await tokenManager.getInstallationToken(mockUserConfig);

      expect(result).toBe('new-token-expired');
      expect(generateInstallationToken).toHaveBeenCalledWith(
        mockUserConfig,
        mockEnv,
      );
    });

    it('should return null when token generation fails', async () => {
      // Mock no cached token
      mockDurableObject.fetch.mockResolvedValueOnce({
        ok: false,
      });

      // Mock failed token generation
      (generateInstallationToken as Mock).mockResolvedValue(null);

      const result = await tokenManager.getInstallationToken(mockUserConfig);

      expect(result).toBeNull();
    });

    it('should handle errors gracefully and return null', async () => {
      // Mock error in cached token retrieval
      mockDurableObject.fetch.mockRejectedValue(new Error('Network error'));

      const result = await tokenManager.getInstallationToken(mockUserConfig);

      expect(result).toBeNull();
    });

    it('should add 5-minute buffer to token expiration check', async () => {
      const tokenExpiringIn4Minutes: UserInstallationToken = {
        installationId: '12345',
        token: 'expiring-soon-token',
        expiresAt: Date.now() + 4 * 60 * 1000, // 4 minutes from now
        userId: 'test-user-123',
      };

      // Mock token that expires within buffer period
      mockDurableObject.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(tokenExpiringIn4Minutes),
      });

      // Mock successful token caching for new token
      mockDurableObject.fetch.mockResolvedValueOnce({
        ok: true,
      });

      // Mock new token generation
      (generateInstallationToken as Mock).mockResolvedValue('fresh-token');

      const result = await tokenManager.getInstallationToken(mockUserConfig);

      expect(result).toBe('fresh-token');
      expect(generateInstallationToken).toHaveBeenCalled();
    });
  });

  describe('invalidateToken', () => {
    it('should successfully invalidate cached token', async () => {
      mockDurableObject.fetch.mockResolvedValueOnce({
        ok: true,
      });

      await tokenManager.invalidateToken('12345', 'test-user-123');

      expect(mockDurableObject.fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'DELETE',
          url: 'http://localhost/installation-token?installationId=12345&userId=test-user-123',
        }),
      );
    });

    it('should handle invalidation errors gracefully', async () => {
      mockDurableObject.fetch.mockRejectedValue(new Error('Network error'));

      // Should not throw
      await expect(
        tokenManager.invalidateToken('12345', 'test-user-123'),
      ).resolves.not.toThrow();
    });
  });

  describe('token caching', () => {
    it('should cache token with proper expiration', async () => {
      // Mock no cached token
      mockDurableObject.fetch.mockResolvedValueOnce({
        ok: false,
      });

      // Mock successful token caching
      mockDurableObject.fetch.mockResolvedValueOnce({
        ok: true,
      });

      // Mock new token generation
      (generateInstallationToken as Mock).mockResolvedValue('cache-test-token');

      await tokenManager.getInstallationToken(mockUserConfig);

      // Verify caching call
      const cacheCall = mockDurableObject.fetch.mock.calls.find(
        (call: any[]) =>
          call[0]?.method === 'POST' &&
          call[0]?.url === 'http://localhost/installation-token',
      );

      expect(cacheCall).toBeDefined();

      // Parse the cached token data
      const cachedData = JSON.parse(cacheCall[0].body);
      expect(cachedData).toMatchObject({
        installationId: '12345',
        token: 'cache-test-token',
        userId: 'test-user-123',
      });
      expect(cachedData.expiresAt).toBeGreaterThan(Date.now());
      expect(cachedData.expiresAt).toBeLessThanOrEqual(
        Date.now() + 60 * 60 * 1000,
      );
    });
  });
});
