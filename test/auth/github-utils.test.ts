import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import {
  createJWT,
  generateInstallationToken,
  validateWebhookSignature,
  getInstallationRepositories,
  getRepositoryBranches,
} from '../../src/github-utils';
import { getFixedGitHubAppConfig } from '../../src/app-config';
import type { UserConfig } from '../../src/types';

// Mock the app-config module
vi.mock('../../src/app-config', () => ({
  getFixedGitHubAppConfig: vi.fn(),
  validateFixedAppConfig: vi.fn(() => true),
}));

// Mock global fetch
global.fetch = vi.fn();

describe('GitHub Utils', () => {
  let mockUserConfig: UserConfig;
  let mockAppConfig: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockUserConfig = {
      userId: 'test-user',
      installationId: '123456',
      anthropicApiKey: 'test-key',
      repositoryAccess: ['owner/repo'],
      created: Date.now(),
      updated: Date.now(),
      isActive: true,
    };

    mockAppConfig = {
      appId: '12345',
      privateKey: `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA4qiXKGHRMTgCfWWGRRNOOW0hJrKYqKhM9yR1YJXqKJwVyGFV
-----END RSA PRIVATE KEY-----`,
      webhookSecret: 'test-webhook-secret',
    };

    (getFixedGitHubAppConfig as Mock).mockReturnValue(mockAppConfig);
  });

  describe('createJWT', () => {
    it('should create valid JWT with correct structure', async () => {
      // Mock crypto.subtle for testing
      const mockSignature = new Uint8Array([1, 2, 3, 4]);
      vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(mockSignature.buffer);

      const jwt = await createJWT(
        mockAppConfig.appId,
        mockAppConfig.privateKey,
      );

      expect(jwt).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

      // Verify JWT structure
      const [header, payload] = jwt.split('.');
      const decodedHeader = JSON.parse(
        atob(header.replace(/-/g, '+').replace(/_/g, '/')),
      );
      const decodedPayload = JSON.parse(
        atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
      );

      expect(decodedHeader).toMatchObject({
        alg: 'RS256',
        typ: 'JWT',
      });

      expect(decodedPayload).toMatchObject({
        iss: mockAppConfig.appId,
      });

      expect(decodedPayload.iat).toBeCloseTo(
        Math.floor(Date.now() / 1000) - 60,
        0,
      );
      expect(decodedPayload.exp).toBeCloseTo(
        Math.floor(Date.now() / 1000) + 600,
        0,
      );
    });

    it('should throw error for invalid private key format', async () => {
      const invalidKey = 'invalid-key-format';

      await expect(createJWT(mockAppConfig.appId, invalidKey)).rejects.toThrow(
        'Invalid PEM format: missing header or footer',
      );
    });

    it('should handle crypto import errors', async () => {
      vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(
        new Error('Import failed'),
      );

      await expect(
        createJWT(mockAppConfig.appId, mockAppConfig.privateKey),
      ).rejects.toThrow('JWT creation failed: Import failed');
    });
  });

  describe('generateInstallationToken', () => {
    it('should generate valid installation token on success', async () => {
      const mockJWT = 'mock.jwt.token';
      const mockTokenResponse = {
        token: 'ghs_installation_token_123',
        expires_at: '2025-09-06T10:00:00Z',
      };

      // Mock JWT creation
      vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(
        new Uint8Array([1, 2, 3]).buffer,
      );

      // Mock successful GitHub API response
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        status: 201,
        statusText: 'Created',
        json: () => Promise.resolve(mockTokenResponse),
      });

      const token = await generateInstallationToken(mockUserConfig);

      expect(token).toBe('ghs_installation_token_123');
      expect(global.fetch).toHaveBeenCalledWith(
        `https://api.github.com/app/installations/${mockUserConfig.installationId}/access_tokens`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Bearer .+/),
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'claude-code-containers/1.0.0',
          }),
        }),
      );
    });

    it('should return null on GitHub API failure', async () => {
      // Mock JWT creation
      vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(
        new Uint8Array([1, 2, 3]).buffer,
      );

      // Mock failed GitHub API response
      (global.fetch as Mock).mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('{"message": "Bad credentials"}'),
      });

      const token = await generateInstallationToken(mockUserConfig);

      expect(token).toBeNull();
    });

    it('should handle network errors gracefully', async () => {
      // Mock JWT creation
      vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(
        new Uint8Array([1, 2, 3]).buffer,
      );

      // Mock network error
      (global.fetch as Mock).mockRejectedValue(new Error('Network error'));

      const token = await generateInstallationToken(mockUserConfig);

      expect(token).toBeNull();
    });

    it('should handle JWT creation failure', async () => {
      // Mock JWT creation failure
      vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(
        new Error('Key import failed'),
      );

      const token = await generateInstallationToken(mockUserConfig);

      expect(token).toBeNull();
    });
  });

  describe('validateWebhookSignature', () => {
    it('should validate correct webhook signature', async () => {
      const body = '{"test": "payload"}';
      const signature = 'sha256=correct_signature_hash';

      // Mock crypto operations for HMAC verification
      const mockSignature = new Uint8Array([171, 205, 239]); // Example hash bytes
      vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(mockSignature.buffer);

      // The signature should match the expected hex representation
      const expectedHex = Array.from(mockSignature)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const isValid = await validateWebhookSignature(
        body,
        `sha256=${expectedHex}`,
      );

      expect(isValid).toBe(true);
      expect(crypto.subtle.importKey).toHaveBeenCalledWith(
        'raw',
        expect.any(Uint8Array),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
    });

    it('should reject invalid webhook signature', async () => {
      const body = '{"test": "payload"}';
      const signature = 'sha256=invalid_signature';

      // Mock crypto operations
      const mockSignature = new Uint8Array([171, 205, 239]);
      vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(mockSignature.buffer);

      const isValid = await validateWebhookSignature(body, signature);

      expect(isValid).toBe(false);
    });

    it('should handle signature without sha256 prefix', async () => {
      const body = '{"test": "payload"}';

      // Mock crypto operations
      const mockSignature = new Uint8Array([171, 205, 239]);
      vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(mockSignature.buffer);

      const expectedHex = Array.from(mockSignature)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const isValid = await validateWebhookSignature(body, expectedHex);

      expect(isValid).toBe(true);
    });

    it('should handle crypto errors gracefully', async () => {
      const body = '{"test": "payload"}';
      const signature = 'sha256=test_signature';

      vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(
        new Error('Crypto error'),
      );

      const isValid = await validateWebhookSignature(body, signature);

      expect(isValid).toBe(false);
    });
  });

  describe('getInstallationRepositories', () => {
    it('should fetch and return installation repositories', async () => {
      const mockRepos = [
        { id: 1, name: 'repo1', full_name: 'owner/repo1' },
        { id: 2, name: 'repo2', full_name: 'owner/repo2' },
      ];

      // Mock JWT creation and token generation
      vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(
        new Uint8Array([1, 2, 3]).buffer,
      );

      // Mock installation token generation
      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              token: 'installation_token',
              expires_at: '2025-09-06T10:00:00Z',
            }),
        })
        // Mock repositories API response
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ repositories: mockRepos }),
        });

      const repos = await getInstallationRepositories(mockUserConfig);

      expect(repos).toEqual(mockRepos);
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'https://api.github.com/installation/repositories',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer installation_token',
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'claude-code-containers/1.0.0',
          }),
        }),
      );
    });

    it('should return empty array when token generation fails', async () => {
      // Mock failed token generation
      vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(
        new Error('Token generation failed'),
      );

      const repos = await getInstallationRepositories(mockUserConfig);

      expect(repos).toEqual([]);
    });

    it('should return empty array when repositories API fails', async () => {
      // Mock successful token generation
      vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(
        new Uint8Array([1, 2, 3]).buffer,
      );

      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              token: 'installation_token',
              expires_at: '2025-09-06T10:00:00Z',
            }),
        })
        // Mock failed repositories API response
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
        });

      const repos = await getInstallationRepositories(mockUserConfig);

      expect(repos).toEqual([]);
    });

    it('should handle network errors gracefully', async () => {
      // Mock token generation success but network error for repos
      vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(
        new Uint8Array([1, 2, 3]).buffer,
      );

      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              token: 'installation_token',
              expires_at: '2025-09-06T10:00:00Z',
            }),
        })
        .mockRejectedValueOnce(new Error('Network error'));

      const repos = await getInstallationRepositories(mockUserConfig);

      expect(repos).toEqual([]);
    });

    it('should include pagination parameters when provided', async () => {
      vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(
        new Uint8Array([1, 2, 3]).buffer,
      );

      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              token: 'installation_token',
              expires_at: '2025-09-06T10:00:00Z',
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ repositories: [] }),
        });

      await getInstallationRepositories(mockUserConfig, {
        perPage: 50,
        page: 2,
      });

      expect(global.fetch as Mock).toHaveBeenNthCalledWith(
        2,
        'https://api.github.com/installation/repositories?per_page=50&page=2',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer installation_token',
          }),
        }),
      );
    });
  });

  describe('getRepositoryBranches', () => {
    it('should fetch repository branches', async () => {
      const mockBranches = [
        {
          name: 'main',
          commit: {
            sha: 'abc123',
            url: 'https://api.github.com/repos/owner/repo/commits/abc123',
          },
          protected: true,
        },
      ];

      vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(
        new Uint8Array([1, 2, 3]).buffer,
      );

      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              token: 'installation_token',
              expires_at: '2025-09-06T10:00:00Z',
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockBranches),
        });

      const branches = await getRepositoryBranches(
        mockUserConfig,
        'owner',
        'repo',
        {
          perPage: 25,
          page: 3,
          protectedOnly: true,
        },
      );

      expect(branches).toEqual(mockBranches);
      expect(global.fetch as Mock).toHaveBeenNthCalledWith(
        2,
        'https://api.github.com/repos/owner/repo/branches?per_page=25&page=3&protected=true',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer installation_token',
          }),
        }),
      );
    });

    it('should return empty array when token generation fails', async () => {
      vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(
        new Error('Token generation failed'),
      );

      const branches = await getRepositoryBranches(
        mockUserConfig,
        'owner',
        'repo',
      );

      expect(branches).toEqual([]);
    });

    it('should return empty array when branches API fails', async () => {
      vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(
        new Uint8Array([1, 2, 3]).buffer,
      );

      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              token: 'installation_token',
              expires_at: '2025-09-06T10:00:00Z',
            }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        });

      const branches = await getRepositoryBranches(
        mockUserConfig,
        'owner',
        'repo',
      );

      expect(branches).toEqual([]);
    });

    it('should handle network errors gracefully', async () => {
      vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
      vi.spyOn(crypto.subtle, 'sign').mockResolvedValue(
        new Uint8Array([1, 2, 3]).buffer,
      );

      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              token: 'installation_token',
              expires_at: '2025-09-06T10:00:00Z',
            }),
        })
        .mockRejectedValueOnce(new Error('Network error'));

      const branches = await getRepositoryBranches(
        mockUserConfig,
        'owner',
        'repo',
      );

      expect(branches).toEqual([]);
    });
  });
});
