import { describe, it, expect, vi, afterEach } from 'vitest';
import { ContainerServiceImpl } from '../../infrastructure/services/container.service.impl';
import { ValidationError } from '../../shared/errors/validation.error';

type TestDurableObjectId = { name: string };
type TestDurableObjectNamespace = {
  idFromName(name: string): TestDurableObjectId;
  get(id: TestDurableObjectId): { fetch(request: Request): Promise<Response> };
};

function createNamespace(handler: (request: Request) => Promise<Response> | Response) {
  const fetchSpy = vi.fn(async (request: Request) => {
    return await handler(request);
  });
  let lastIdFromNameArg: string | undefined;

  const namespace: TestDurableObjectNamespace = {
    idFromName: vi.fn((name: string) => {
      lastIdFromNameArg = name;
      return { name };
    }),
  get: vi.fn(() => ({ fetch: fetchSpy })),
  };

  return {
    namespace: namespace as unknown as any,
    fetchSpy,
    lastIdFromNameArgRef: () => lastIdFromNameArg,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ContainerServiceImpl', () => {
  it('spawns containers via Durable Object', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

    const { namespace, fetchSpy, lastIdFromNameArgRef } = createNamespace(async (request) => {
      expect(request.method).toBe('POST');
      expect(new URL(request.url).pathname).toBe('/container');
      const body = await request.json();
      expect(body.sessionId).toBe('inst-1:user-1');
      return new Response(JSON.stringify(body), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const service = new ContainerServiceImpl(namespace);
    const result = await service.spawn({
      configId: 'cfg1',
      installationId: 'inst-1',
      userId: 'user-1',
      containerImage: 'node:18',
      environmentVariables: { NODE_ENV: 'test' },
      resourceLimits: { cpuMillis: 500, memoryMb: 512, timeoutSeconds: 60 },
    });

  expect(result.containerId).toBe('ctr_cfg1_4fzzzxjy');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(lastIdFromNameArgRef()).toBe('ctr_cfg1_4fzzzxjy');
  });

  it('executes commands and returns result payload', async () => {
    const { namespace } = createNamespace(async (request) => {
      if (request.method === 'POST' && new URL(request.url).pathname === '/command') {
        const body = await request.json();
        expect(body.containerId).toBe('ctr-1');
        expect(body.command).toBe('npm test');
        return new Response(
          JSON.stringify({ exitCode: 0, stdout: 'ok', stderr: '' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('not-handled', { status: 404 });
    });

    const service = new ContainerServiceImpl(namespace);
    const result = await service.execute('ctr-1', 'npm test');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ok');
  });

  it('retrieves logs with GET request parameters', async () => {
    const { namespace, fetchSpy } = createNamespace(async (request) => {
      expect(request.method).toBe('GET');
      const url = new URL(request.url);
      expect(url.pathname).toBe('/logs');
      expect(url.searchParams.get('containerId')).toBe('ctr-logs');
      return new Response(JSON.stringify(['line one', 'line two']), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const service = new ContainerServiceImpl(namespace);
    const logs = await service.getLogs('ctr-logs');

    expect(logs).toEqual(['line one', 'line two']);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('terminates containers via DELETE call', async () => {
    const { namespace } = createNamespace(async (request) => {
      expect(request.method).toBe('DELETE');
      const url = new URL(request.url);
      expect(url.pathname).toBe('/container');
      expect(url.searchParams.get('containerId')).toBe('ctr-terminate');
      return new Response('OK', { status: 200 });
    });

    const service = new ContainerServiceImpl(namespace);
    await service.terminate('ctr-terminate');
  });

  it('returns stopped status when DO returns null payload', async () => {
    const { namespace } = createNamespace(async (request) => {
      if (request.method === 'GET' && new URL(request.url).pathname === '/container') {
        return new Response('null', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('OK', { status: 200 });
    });

    const service = new ContainerServiceImpl(namespace);
    const status = await service.getStatus('ctr-missing');

    expect(status).toBe('stopped');
  });

  it('validates spawn parameters before calling Durable Object', async () => {
    const { namespace, fetchSpy } = createNamespace(async () => new Response('OK', { status: 200 }));
    const service = new ContainerServiceImpl(namespace);

    await expect(
      service.spawn({
        configId: '',
        installationId: 'inst',
        userId: 'user',
        containerImage: 'node:18',
        environmentVariables: {},
        resourceLimits: { cpuMillis: 100, memoryMb: 128, timeoutSeconds: 30 },
      }),
    ).rejects.toThrow(ValidationError);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
