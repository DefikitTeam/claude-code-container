/**
 * E2E Test: User Registration Flow
 * Tests the complete user registration use case with mocked dependencies
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RegisterUserUseCase } from '../core/use-cases/user/register-user.use-case';
import { ValidationError } from '../shared/errors/validation.error';
import { NotFoundError } from '../shared/errors/not-found.error';

describe('E2E: User Registration Flow', () => {
  let useCase: RegisterUserUseCase;
  let mockUserRepository: any;
  let mockGitHubService: any;
  let mockCryptoService: any;

  beforeEach(() => {
    // Mock repository
    mockUserRepository = {
      save: vi.fn().mockResolvedValue(undefined),
      findById: vi.fn().mockResolvedValue(null),
      findByInstallationId: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      listByInstallation: vi.fn().mockResolvedValue([]),
    };

    // Mock GitHub service
    mockGitHubService = {
      validateInstallation: vi.fn().mockResolvedValue(true),
      fetchRepositories: vi.fn().mockResolvedValue([
        {
          id: 1,
          name: 'repo1',
          fullName: 'org/repo1',
          url: 'https://github.com/org/repo1',
        },
        {
          id: 2,
          name: 'repo2',
          fullName: 'org/repo2',
          url: 'https://github.com/org/repo2',
        },
      ]),
      fetchBranches: vi.fn().mockResolvedValue([]),
      createPullRequest: vi.fn().mockResolvedValue({}),
      createIssue: vi.fn().mockResolvedValue({}),
      addComment: vi.fn().mockResolvedValue({}),
    };

    // Mock crypto service
    mockCryptoService = {
      encrypt: vi
        .fn()
        .mockResolvedValue({
          encryptedData: new Uint8Array(),
          iv: new Uint8Array(),
        }),
      decrypt: vi.fn().mockResolvedValue('decrypted'),
      hash: vi.fn().mockResolvedValue('hash'),
    };

    useCase = new RegisterUserUseCase(
      mockUserRepository,
      mockGitHubService,
      mockCryptoService,
    );
  });

  it('should successfully register a new user', async () => {
    const result = await useCase.execute({
      userId: 'user123',
      installationId: 'inst456',
      anthropicApiKey: 'api-key-xyz',
      projectLabel: 'My Project',
    });

    expect(result.userId).toBe('user123');
    expect(result.installationId).toBe('inst456');
    expect(result.projectLabel).toBe('My Project');
    expect(result.created).toBeDefined();
    expect(mockGitHubService.validateInstallation).toHaveBeenCalledWith(
      'inst456',
    );
    expect(mockUserRepository.save).toHaveBeenCalled();
  });

  it('should automatically fetch repositories if not provided', async () => {
    await useCase.execute({
      userId: 'user123',
      installationId: 'inst456',
      anthropicApiKey: 'api-key-xyz',
    });

    expect(mockGitHubService.fetchRepositories).toHaveBeenCalledWith('inst456');
  });

  it('should throw ValidationError when required fields are missing', async () => {
    await expect(
      useCase.execute({
        userId: '',
        installationId: 'inst456',
        anthropicApiKey: 'api-key-xyz',
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('should throw NotFoundError when installation is invalid', async () => {
    mockGitHubService.validateInstallation.mockResolvedValue(false);

    await expect(
      useCase.execute({
        userId: 'user123',
        installationId: 'invalid',
        anthropicApiKey: 'api-key-xyz',
      }),
    ).rejects.toThrow(NotFoundError);
  });
});
