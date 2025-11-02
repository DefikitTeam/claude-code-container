import { describe, it, expect, vi } from 'vitest';
import { UserRepositoryDurableObjectAdapter } from '../../infrastructure/adapters/user-repository.do-adapter';
import { UserEntity } from '../../core/entities/user.entity';
import { ValidationError } from '../../shared/errors/validation.error';

interface RecordedRequest {
  method: string;
  url: string;
  body?: any;
}

type TestDurableObjectId = { name: string };
type TestDurableObjectNamespace = {
  idFromName(name: string): TestDurableObjectId;
  get(id: TestDurableObjectId): { fetch(request: Request): Promise<Response> };
};

function createNamespace(
  handler: (request: Request, parsedBody: unknown) => Promise<Response> | Response,
) {
  const requests: RecordedRequest[] = [];

  const fetchSpy = vi.fn(async (request: Request) => {
    let parsedBody: unknown;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const clone = request.clone();
      const text = await clone.text();
      parsedBody = text ? JSON.parse(text) : undefined;
    }

    requests.push({ method: request.method, url: request.url, body: parsedBody });
    return handler(request, parsedBody);
  });

  const namespace: TestDurableObjectNamespace = {
    idFromName: vi.fn((name: string) => ({ name })),
    get: vi.fn(() => ({ fetch: fetchSpy })),
  };

  return {
    namespace: namespace as unknown as any,
    fetchSpy,
    requests,
  };
}

describe('UserRepositoryDurableObjectAdapter', () => {
  const baseUserProps = {
    userId: 'user-123',
    installationId: 'inst-123',
    anthropicApiKey: 'encrypted',
    repositoryAccess: ['repo-a'],
    isActive: true,
    created: 1700000000000,
    updated: 1700000000000,
    projectLabel: 'Demo',
  };

  it('saves users via POST request', async () => {
    const { namespace, requests } = createNamespace(async () => new Response(null, { status: 204 }));
    const adapter = new UserRepositoryDurableObjectAdapter(namespace);
    const entity = new UserEntity(baseUserProps);

    await adapter.save(entity);

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/user');
    expect(request.body.userId).toBe('user-123');
    expect(request.body.installationId).toBe('inst-123');
  });

  it('retrieves users by id', async () => {
    const { namespace } = createNamespace(async (request) => {
      const url = new URL(request.url);
      expect(url.searchParams.get('userId')).toBe('user-123');
      return new Response(JSON.stringify(baseUserProps), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const adapter = new UserRepositoryDurableObjectAdapter(namespace);
    const user = await adapter.findById('user-123');

    expect(user).not.toBeNull();
    expect(user?.installationId).toBe('inst-123');
  });

  it('returns null when user not found', async () => {
    const { namespace } = createNamespace(async () => new Response('missing', { status: 404 }));
    const adapter = new UserRepositoryDurableObjectAdapter(namespace);

    const user = await adapter.findById('ghost');
    expect(user).toBeNull();
  });

  it('lists users for an installation', async () => {
    const { namespace } = createNamespace(async (request) => {
      const url = new URL(request.url);
      expect(url.searchParams.get('installationId')).toBe('inst-123');
      return new Response(JSON.stringify([baseUserProps]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const adapter = new UserRepositoryDurableObjectAdapter(namespace);
    const users = await adapter.findByInstallationId('inst-123');

    expect(users).toHaveLength(1);
    expect(users[0].userId).toBe('user-123');
  });

  it('deletes users through DELETE request', async () => {
    const { namespace, requests } = createNamespace(async () => new Response(null, { status: 200 }));
    const adapter = new UserRepositoryDurableObjectAdapter(namespace);

    await adapter.delete('user-123');

    expect(requests).toHaveLength(1);
    const { method, url } = requests[0];
    expect(method).toBe('DELETE');
    expect(new URL(url).searchParams.get('userId')).toBe('user-123');
  });

  it('validates identifiers before calling Durable Object', async () => {
    const { namespace, fetchSpy } = createNamespace(async () => new Response(null, { status: 200 }));
    const adapter = new UserRepositoryDurableObjectAdapter(namespace);

    await expect(adapter.findById('')).rejects.toThrow(ValidationError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
