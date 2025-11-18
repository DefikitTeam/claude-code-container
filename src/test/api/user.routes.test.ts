import { describe, it, beforeEach, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { UserController } from '../../api/controllers/user.controller';
import { createUserRoutes } from '../../api/routes/user.routes';
import { attachRequestContext } from '../../api/middleware/validation.middleware';
import { InMemoryUserRepository } from '../../infrastructure/repositories/in-memory-user.repository';
import { RegisterUserUseCase } from '../../core/use-cases/user/register-user.use-case';
import { GetUserUseCase } from '../../core/use-cases/user/get-user.use-case';
import { UpdateUserUseCase } from '../../core/use-cases/user/update-user.use-case';
import { DeleteUserUseCase } from '../../core/use-cases/user/delete-user.use-case';
import { registerErrorMiddleware } from '../../api/middleware/error.middleware';

const MOCK_INSTALLATION_ID = '123456';
const MOCK_USER_ID = 'user-123';

describe('API: User Routes', () => {
  let app: Hono;

  beforeEach(() => {
    const userRepository = new InMemoryUserRepository();

    const githubService = {
      validateInstallation: vi.fn().mockResolvedValue(true),
      fetchRepositories: vi.fn().mockResolvedValue([
        { id: 1, name: 'repo1', fullName: 'org/repo1', url: 'https://example.com/repo1' },
        { id: 2, name: 'repo2', fullName: 'org/repo2', url: 'https://example.com/repo2' },
      ]),
      fetchBranches: vi.fn(),
      createPullRequest: vi.fn(),
      createIssue: vi.fn(),
      addComment: vi.fn(),
    };

    const cryptoService = {
      encrypt: vi.fn().mockResolvedValue({ encryptedData: new Uint8Array([1, 2, 3]), iv: new Uint8Array([4, 5, 6]) }),
      decrypt: vi.fn().mockResolvedValue('decrypted-key'),
      hash: vi.fn().mockResolvedValue('hash'),
      verifyWebhookSignature: vi.fn().mockResolvedValue(true),
      initialize: vi.fn(),
    } as any;

    const registerUserUseCase = new RegisterUserUseCase(userRepository, githubService as any, cryptoService);
    const getUserUseCase = new GetUserUseCase(userRepository);
    const updateUserUseCase = new UpdateUserUseCase(userRepository, cryptoService);
    const deleteUserUseCase = new DeleteUserUseCase(userRepository);

    const controller = new UserController(
      registerUserUseCase,
      getUserUseCase,
      updateUserUseCase,
      deleteUserUseCase,
    );

    app = new Hono();
    app.use('*', attachRequestContext());
    registerErrorMiddleware(app);
    app.route('/api/users', createUserRoutes(controller));
  });

  it('registers, retrieves, updates, and deletes a user', async () => {
    const registerResponse = await app.request('/api/users/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-installation-id': MOCK_INSTALLATION_ID,
        'x-user-id': MOCK_USER_ID,
      },
      body: JSON.stringify({
        anthropicApiKey: 'sk-ant-mock-key-1234567890',
        projectLabel: 'Demo Project',
      }),
    });

    expect(registerResponse.status).toBe(201);
    const registerJson = await registerResponse.json();
  expect(registerJson.success).toBe(true);
  expect(registerJson.data.userId).toBe(MOCK_USER_ID);
  expect(registerJson.data.installationId).toBe(MOCK_INSTALLATION_ID);

    const getResponse = await app.request(`/api/users/${MOCK_USER_ID}`, {
      method: 'GET',
      headers: {
        'x-installation-id': MOCK_INSTALLATION_ID,
        'content-type': 'application/json',
      },
    });

    expect(getResponse.status).toBe(200);
    const getJson = await getResponse.json();
    expect(getJson.data.userId).toBe(MOCK_USER_ID);
    // Repository access may be empty since auto-fetching is currently disabled
    expect(Array.isArray(getJson.data.repositoryAccess)).toBe(true);

    const updateResponse = await app.request(`/api/users/${MOCK_USER_ID}`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-installation-id': MOCK_INSTALLATION_ID,
      },
      body: JSON.stringify({
        repositoryAccess: ['org/custom-repo'],
      }),
    });

    expect(updateResponse.status).toBe(200);
    const updateJson = await updateResponse.json();
    expect(updateJson.data.userId).toBe(MOCK_USER_ID);
    expect(updateJson.data.message).toContain('updated');

    const deleteResponse = await app.request(`/api/users/${MOCK_USER_ID}`, {
      method: 'DELETE',
      headers: {
        'x-installation-id': MOCK_INSTALLATION_ID,
      },
    });

    expect(deleteResponse.status).toBe(200);
    const deleteJson = await deleteResponse.json();
    expect(deleteJson.data.userId).toBe(MOCK_USER_ID);
    expect(deleteJson.data.message).toContain('deleted');

    const getAfterDelete = await app.request(`/api/users/${MOCK_USER_ID}`, {
      method: 'GET',
      headers: {
        'x-installation-id': MOCK_INSTALLATION_ID,
      },
    });

    expect(getAfterDelete.status).toBe(404);
  });
});
