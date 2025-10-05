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
import type { Env } from '../../src/types';
import { getInstallationRepositories } from '../../src/github-utils';

const mockedGetInstallationRepositories = vi.mocked(
  getInstallationRepositories,
);

type RegistrationRecord = {
  userId: string;
  installationId: string;
  anthropicApiKey: string;
  projectLabel?: string;
  created: number;
  updated: number;
  isActive: boolean;
};

class MockUserConfigDO {
  private registrations = new Map<string, RegistrationRecord>();
  private directory = new Map<string, string[]>();
  private counter = 0;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const key = `${request.method.toUpperCase()} ${url.pathname}`;

    switch (key) {
      case 'POST /register':
        return this.handleRegister(request);
      case 'GET /user':
        return this.handleGetUser(url);
      case 'GET /user-by-installation':
        return this.handleDirectory(url);
      case 'DELETE /user':
        return this.handleDelete(url);
      default:
        return new Response(
          JSON.stringify({ error: `Unhandled route ${key}` }),
          { status: 500 },
        );
    }
  }

  private async handleRegister(request: Request): Promise<Response> {
    const body = (await request.json()) as {
      installationId: string;
      anthropicApiKey: string;
      userId?: string;
      projectLabel?: string;
    };

    const existing = this.directory.get(body.installationId) ?? [];
    const userId = body.userId ?? this.generateUserId();

    if (this.registrations.has(userId)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'UserId already exists for this installation',
          registrations: this.listRegistrations(body.installationId),
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const timestamp = Date.now();
    const record: RegistrationRecord = {
      userId,
      installationId: body.installationId,
      anthropicApiKey: body.anthropicApiKey,
      projectLabel: body.projectLabel,
      created: timestamp,
      updated: timestamp,
      isActive: true,
    };

    this.registrations.set(userId, record);
    this.directory.set(body.installationId, [...existing, userId]);

    return new Response(
      JSON.stringify({
        success: true,
        userId,
        installationId: body.installationId,
        projectLabel: body.projectLabel,
        existingRegistrations: existing.map((id) => {
          const reg = this.registrations.get(id)!;
          return {
            userId: reg.userId,
            projectLabel: reg.projectLabel ?? null,
            created: reg.created,
          };
        }),
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    );
  }

  private async handleGetUser(url: URL): Promise<Response> {
    const userId = url.searchParams.get('userId');
    if (!userId || !this.registrations.has(userId)) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const record = this.registrations.get(userId)!;
    const siblings = this.directory.get(record.installationId) ?? [];
    const existing = siblings
      .filter((id) => id !== userId)
      .map((id) => {
        const reg = this.registrations.get(id)!;
        return { userId: reg.userId, projectLabel: reg.projectLabel ?? null };
      });

    return new Response(
      JSON.stringify({
        ...record,
        existingRegistrations: existing,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  private async handleDirectory(url: URL): Promise<Response> {
    const installationId = url.searchParams.get('installationId');
    if (!installationId) {
      return new Response(
        JSON.stringify({ error: 'installationId parameter is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const userIds = this.directory.get(installationId) ?? [];
    if (userIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'User not found for installation ID' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({
        installationId,
        registrations: userIds.map((id) => {
          const reg = this.registrations.get(id)!;
          return {
            userId: reg.userId,
            projectLabel: reg.projectLabel ?? null,
            isActive: reg.isActive,
          };
        }),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  private async handleDelete(url: URL): Promise<Response> {
    const userId = url.searchParams.get('userId');
    if (!userId || !this.registrations.has(userId)) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const record = this.registrations.get(userId)!;
    this.registrations.delete(userId);
    const updated = (this.directory.get(record.installationId) ?? []).filter(
      (id) => id !== userId,
    );
    if (updated.length === 0) {
      this.directory.delete(record.installationId);
    } else {
      this.directory.set(record.installationId, updated);
    }

    return new Response(
      JSON.stringify({
        success: true,
        removedUserId: userId,
        installationId: record.installationId,
        remainingRegistrations: updated.map((id) => {
          const reg = this.registrations.get(id)!;
          return {
            userId: reg.userId,
            projectLabel: reg.projectLabel ?? null,
          };
        }),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  private listRegistrations(installationId: string) {
    const ids = this.directory.get(installationId) ?? [];
    return ids.map((id) => {
      const reg = this.registrations.get(id)!;
      return { userId: reg.userId, projectLabel: reg.projectLabel ?? null };
    });
  }

  private generateUserId() {
    this.counter += 1;
    return `user-${this.counter}`;
  }
}

describe('Integration: multi-registration quickstart flow', () => {
  let env: Env;
  let fetchMock: ReturnType<typeof vi.fn>;
  let userConfigDO: MockUserConfigDO;

  beforeEach(() => {
    mockedGetInstallationRepositories.mockReset();

    userConfigDO = new MockUserConfigDO();
    fetchMock = vi.fn((request: Request) => userConfigDO.fetch(request));

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

  it('registers two projects, enforces disambiguation, and cleans up gracefully', async () => {
    // Register first project
    const firstRegistration = await app.request(
      'http://localhost/register-user',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installationId: '123',
          anthropicApiKey: 'sk-anthropic-FIRST-1234567890',
          projectLabel: 'Project One',
        }),
      },
      env,
    );

    expect(firstRegistration.status).toBe(201);
    const firstBody = await firstRegistration.json();
    expect(firstBody.userId).toBeDefined();
    expect(firstBody.existingRegistrations).toEqual([]);

    // Register second project for same installation
    const secondRegistration = await app.request(
      'http://localhost/register-user',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installationId: '123',
          anthropicApiKey: 'sk-anthropic-SECOND-0987654321',
          projectLabel: 'Project Two',
        }),
      },
      env,
    );

    expect(secondRegistration.status).toBe(201);
    const secondBody = await secondRegistration.json();
    expect(secondBody.userId).not.toBe(firstBody.userId);
    expect(secondBody.existingRegistrations).toHaveLength(1);

    // Attempt to list repositories without userId should produce conflict guidance
    const conflictResponse = await app.request(
      'http://localhost/github/repositories?installationId=123',
      undefined,
      env,
    );

    expect(conflictResponse.status).toBe(409);
    const conflictBody = await conflictResponse.json();
    expect(conflictBody.success).toBe(false);
    expect(conflictBody.registrations).toHaveLength(2);

    // Provide explicit userId to resolve repositories
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

    const repoResponse = await app.request(
      `http://localhost/github/repositories?installationId=123&userId=${firstBody.userId}`,
      undefined,
      env,
    );

    expect(repoResponse.status).toBe(200);
    const repoBody = await repoResponse.json();
    expect(repoBody.repositories).toHaveLength(1);

    // Delete the second registration and ensure directory updates remain
    const deleteResponse = await app.request(
      `http://localhost/user-config/${secondBody.userId}`,
      { method: 'DELETE' },
      env,
    );

    expect(deleteResponse.status).toBe(200);
    const deleteBody = await deleteResponse.json();
    expect(deleteBody.remainingRegistrations).toEqual([
      expect.objectContaining({ userId: firstBody.userId }),
    ]);
  });
});
