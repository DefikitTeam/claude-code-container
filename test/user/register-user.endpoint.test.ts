import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { addUserEndpoints } from '../../src/user-endpoints';
import type { Env } from '../../src/types';

const createStubNamespace = (fetchImpl: ReturnType<typeof vi.fn>) => {
  return {
    idFromName: vi.fn(() => ({ toString: () => 'stub-id' })),
    get: vi.fn(() => ({ fetch: fetchImpl })),
  } as any;
};

describe('POST /register-user multi-registration support', () => {
  const app = new Hono<{ Bindings: Env }>();
  addUserEndpoints(app);

  let fetchMock: ReturnType<typeof vi.fn>;
  let env: Env;

  beforeEach(() => {
    fetchMock = vi.fn();
    env = {
      USER_CONFIG: createStubNamespace(fetchMock),
      MY_CONTAINER: {} as any,
      GITHUB_APP_CONFIG: {} as any,
      ACP_SESSION: {} as any,
    } as Env;
  });

  it('returns 201 with existing registrations when Durable Object stores multiple entries', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          userId: 'user-second',
          installationId: '123',
          existingRegistrations: [
            { userId: 'user-first', projectLabel: 'Primary', created: 10 },
          ],
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const response = await app.request(
      'http://localhost/register-user',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installationId: '123',
          anthropicApiKey: 'sk-anthropic-1234567890-example',
          projectLabel: 'Follow-up Project',
        }),
      },
      env,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      userId: 'user-second',
      installationId: '123',
      existingRegistrations: [
        { userId: 'user-first', projectLabel: 'Primary', created: 10 },
      ],
    });
  });

  it('bubbles up conflict guidance with registrations when Durable Object rejects duplicate alias', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: 'UserId already exists for this installation',
          registrations: [
            { userId: 'user-first', projectLabel: 'Primary' },
            { userId: 'user-second', projectLabel: null },
          ],
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const response = await app.request(
      'http://localhost/register-user',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          installationId: '123',
          anthropicApiKey: 'sk-anthropic-9876543210-example',
          userId: 'user-first',
        }),
      },
      env,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body).toHaveProperty('registrations');
    expect(body.registrations).toHaveLength(2);
  });
});
