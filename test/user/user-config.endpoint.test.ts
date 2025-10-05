import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { addUserEndpoints } from '../../src/user-endpoints';
import type { Env } from '../../src/types';

describe('User configuration endpoints reflect multi-registration directory', () => {
  const app = new Hono<{ Bindings: Env }>();
  addUserEndpoints(app);

  let fetchMock: ReturnType<typeof vi.fn>;
  let env: Env;

  beforeEach(() => {
    fetchMock = vi.fn();
    env = {
      USER_CONFIG: {
        idFromName: vi.fn(() => ({ toString: () => 'user-config' })),
        get: vi.fn(() => ({ fetch: fetchMock })),
      } as any,
      MY_CONTAINER: {} as any,
      GITHUB_APP_CONFIG: {} as any,
      ACP_SESSION: {} as any,
    } as Env;
  });

  it('includes installation directory context when retrieving user config', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          userId: 'user-a',
          installationId: 'install-1',
          anthropicApiKey: 'sk-anthropic-example',
          repositoryAccess: [],
          created: 1,
          updated: 1,
          isActive: true,
          existingRegistrations: [
            { userId: 'user-a', projectLabel: 'Alpha' },
            { userId: 'user-b', projectLabel: 'Beta' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const response = await app.request(
      'http://localhost/user-config/user-a',
      undefined,
      env,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'http://localhost/user?userId=user-a' }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.user).toMatchObject({ userId: 'user-a' });
    expect(body).toHaveProperty('existingRegistrations');
    expect(body.existingRegistrations).toHaveLength(2);
  });

  it('returns remaining registrations after deleting a user', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          removedUserId: 'user-b',
          installationId: 'install-1',
          remainingRegistrations: [
            { userId: 'user-a', projectLabel: 'Alpha' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const response = await app.request(
      'http://localhost/user-config/user-b',
      { method: 'DELETE' },
      env,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost/user?userId=user-b',
        method: 'DELETE',
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body).toHaveProperty('remainingRegistrations');
    expect(body.remainingRegistrations).toMatchObject([
      { userId: 'user-a', projectLabel: 'Alpha' },
    ]);
  });
});
