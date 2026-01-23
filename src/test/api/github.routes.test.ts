import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { GitHubController } from '../../api/controllers/github.controller';
import { createGitHubRoutes } from '../../api/routes/github.routes';
import type { ApiResponse } from '../../shared/types/common.types';
import { attachRequestContext } from '../../api/middleware/validation.middleware';
import { registerErrorMiddleware } from '../../api/middleware/error.middleware';

const INSTALLATION_HEADER = { 'x-installation-id': 'inst-123' };

describe('GitHub Routes', () => {
  let processWebhookUseCase: any;
  let fetchRepositoriesUseCase: any;
  let fetchBranchesUseCase: any;
  let createPullRequestUseCase: any;
  let app: Hono;

  beforeEach(() => {
    processWebhookUseCase = {
      execute: vi.fn().mockResolvedValue({ handled: true }),
    };
    fetchRepositoriesUseCase = {
      execute: vi.fn().mockResolvedValue({
        repositories: [
          { id: 1, name: 'repo', fullName: 'org/repo', url: 'url' },
        ],
        count: 1,
      }),
    };
    fetchBranchesUseCase = {
      execute: vi.fn().mockResolvedValue({
        branches: [
          { name: 'main', commit: { sha: 'sha-main' } },
          { name: 'release', commit: { sha: 'sha-release' } },
        ],
        count: 2,
      }),
    };
    createPullRequestUseCase = {
      execute: vi
        .fn()
        .mockResolvedValue({ url: 'https://github.com/org/repo/pull/1' }),
    };

    const controller = new GitHubController(
      processWebhookUseCase,
      fetchRepositoriesUseCase,
      fetchBranchesUseCase,
      createPullRequestUseCase,
    );
    app = new Hono();
    app.use('*', attachRequestContext());
    registerErrorMiddleware(app);
    app.route('/api/github', createGitHubRoutes(controller));
  });

  it('processes webhook events through the controller', async () => {
    const response = await app.request('/api/github/webhooks', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...INSTALLATION_HEADER,
      },
      body: JSON.stringify({ event: 'push', ref: 'refs/heads/main' }),
    });

    const json = await response.json<ApiResponse<{ handled: boolean }>>();
    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data!.handled).toBe(true);
    expect(processWebhookUseCase.execute).toHaveBeenCalledWith({
      installationId: 'inst-123',
      eventType: 'push',
      payload: expect.objectContaining({ ref: 'refs/heads/main' }),
    });
  });

  it('fetches repositories for an installation', async () => {
    const response = await app.request('/api/github/repositories', {
      method: 'GET',
      headers: INSTALLATION_HEADER,
    });

    const json = await response.json<ApiResponse<{ repositories: any[]; count: number }>>();
    expect(json.data!.count).toBe(1);
    expect(fetchRepositoriesUseCase.execute).toHaveBeenCalledWith({
      installationId: 'inst-123',
    });
  });

  it('rejects requests without installation header', async () => {
    const response = await app.request('/api/github/repositories', {
      method: 'GET',
    });

    const json = await response.json<ApiResponse<{ handled: boolean }>>();
    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error!.code).toBe('VALIDATION_ERROR');
  });

  it('returns validation error when repository param is malformed', async () => {
    const response = await app.request(
      '/api/github/repositories/invalid/branches',
      {
        method: 'GET',
        headers: INSTALLATION_HEADER,
      },
    );

    const json = await response.json<ApiResponse<{ handled: boolean }>>();
    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error!.code).toBe('VALIDATION_ERROR');
  });

  it('fetches branches when repository path is valid', async () => {
    const response = await app.request(
      '/api/github/repositories/org%2Frepo/branches',
      {
        method: 'GET',
        headers: INSTALLATION_HEADER,
      },
    );

    const json = await response.json<ApiResponse<{ branches: any[]; count: number }>>();
    expect(json.data!.branches[0].name).toBe('main');
    expect(json.data!.count).toBe(2);
    expect(fetchBranchesUseCase.execute).toHaveBeenCalledWith({
      installationId: 'inst-123',
      owner: 'org',
      repo: 'repo',
    });
  });

  it('creates pull requests via controller', async () => {
    const response = await app.request('/api/github/pull-requests', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...INSTALLATION_HEADER,
      },
      body: JSON.stringify({
        repository: 'org/repo',
        title: 'Add feature',
        head: 'feature-branch',
        base: 'main',
        body: 'Automated update',
      }),
    });

    const json = await response.json<ApiResponse<{ pullRequest: { url: string } }>>();
    expect(createPullRequestUseCase.execute).toHaveBeenCalledWith({
      owner: 'org',
      repo: 'repo',
      title: 'Add feature',
      head: 'feature-branch',
      base: 'main',
      body: 'Automated update',
      installationId: 'inst-123',
    });
  });
});
