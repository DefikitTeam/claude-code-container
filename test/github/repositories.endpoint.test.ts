import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/github-utils', async () => {
  const actual = await vi.importActual<typeof import('../../src/github-utils')>(
    '../../src/github-utils',
  );
  return {
    ...actual,
    getInstallationRepositories: vi.fn(),
  };
});

import app from '../../src/index';
import type { Env, UserConfig } from '../../src/types';
import { getInstallationRepositories } from '../../src/github-utils';

const mockedGetInstallationRepositories = vi.mocked(
  getInstallationRepositories,
);

describe('GET /github/repositories multi-registration safety checks', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let env: Env;

  beforeEach(() => {
    fetchMock = vi.fn();
    mockedGetInstallationRepositories.mockReset();

    env = {
      USER_CONFIG: {
        idFromName: vi.fn(() => ({ toString: () => 'user-config' })),
        get: vi.fn(() => ({ fetch: fetchMock })),
      } as any,
      MY_CONTAINER: {} as any,
      GITHUB_APP_CONFIG: {
        idFromName: vi.fn(() => ({ toString: () => 'github-config' })),
        get: vi.fn(() => ({ fetch: vi.fn() })),
      } as any,
      ACP_SESSION: {} as any,
    } as Env;
  });

  it('requires userId when multiple registrations exist and provides guidance', async () => {
    fetchMock.mockImplementation(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/user-by-installation') {
        return new Response(
          JSON.stringify({
            installationId: '123',
            registrations: [
              { userId: 'user-a', projectLabel: 'Project A' },
              { userId: 'user-b', projectLabel: 'Project B' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('unexpected', { status: 500 });
    });

    const response = await app.request(
      'http://localhost/github/repositories?installationId=123',
      undefined,
      env,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockedGetInstallationRepositories).not.toHaveBeenCalled();
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body).toHaveProperty('registrations');
    expect(body.registrations).toHaveLength(2);
  });

  it('fetches repositories when userId resolves registration explicitly', async () => {
    const storedConfig: UserConfig = {
      userId: 'user-a',
      installationId: '123',
      anthropicApiKey: 'sk-anthropic-example-1234567890',
      repositoryAccess: [],
      created: Date.now(),
      updated: Date.now(),
      isActive: true,
    };

    fetchMock.mockImplementation(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/user') {
        return new Response(JSON.stringify(storedConfig), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.pathname === '/user-by-installation') {
        return new Response('not used', { status: 404 });
      }
      return new Response('unexpected', { status: 500 });
    });

    mockedGetInstallationRepositories.mockResolvedValueOnce([
      {
        id: 1,
        name: 'repo-one',
        full_name: 'org/repo-one',
        private: false,
        description: 'Test repo',
        html_url: 'https://github.com/org/repo-one',
        default_branch: 'main',
        owner: { login: 'org' },
        permissions: { admin: true },
      },
    ] as any);

    const response = await app.request(
      'http://localhost/github/repositories?installationId=123&userId=user-a&per_page=50&page=2',
      undefined,
      env,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockedGetInstallationRepositories).toHaveBeenCalledWith(
      storedConfig,
      { perPage: 50, page: 2 },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.repositories).toHaveLength(1);
    expect(body.repositories[0]).toMatchObject({
      name: 'repo-one',
      full_name: 'org/repo-one',
    });
  });
});
