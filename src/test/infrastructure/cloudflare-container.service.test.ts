import { describe, it, expect, vi, afterEach } from 'vitest';
import { CloudflareContainerService } from '../../infrastructure/services/cloudflare-container.service';
import { ValidationError } from '../../shared/errors/validation.error';

type TestDurableObjectId = { name: string };
type TestDurableObjectNamespace = {
  idFromName(name: string): TestDurableObjectId;
  get(id: TestDurableObjectId): { fetch(request: Request): Promise<Response> };
};

function createNamespace(
  handler: (request: Request) => Promise<Response> | Response,
) {
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

describe('CloudflareContainerService', () => {
  it('spawns containers via Durable Object', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

    const { namespace, fetchSpy, lastIdFromNameArgRef } = createNamespace(
      async (request) => {
        expect(request.method).toBe('GET');
        expect(new URL(request.url).pathname).toBe('/health');
        return new Response(
          JSON.stringify({
            status: 'healthy',
            message: 'Container ready',
            timestamp: new Date().toISOString(),
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      },
    );

    const service = new CloudflareContainerService(namespace);
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
      if (
        request.method === 'POST' &&
        new URL(request.url).pathname === '/process'
      ) {
        const body = await request.json<{ type: string; command: string }>();
        expect(body.type).toBe('execute');
        expect(body.command).toBe('npm test');
        return new Response(
          JSON.stringify({
            success: true,
            logs: ['test passed'],
            message: 'ok',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('not-handled', { status: 404 });
    });

    const service = new CloudflareContainerService(namespace);
    const result = await service.execute('ctr-1', 'npm test');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('test passed');
  });

  it('retrieves logs with GET request parameters', async () => {
    const { namespace, fetchSpy } = createNamespace(async (request) => {
      expect(request.method).toBe('GET');
      const url = new URL(request.url);
      expect(url.pathname).toBe('/health');
      return new Response(
        JSON.stringify({
          status: 'healthy',
          message: 'Container operational',
          timestamp: '2025-10-28T12:00:00.000Z',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    const service = new CloudflareContainerService(namespace);
    const logs = await service.getLogs('ctr-logs');

    expect(logs).toEqual([
      'Status: healthy',
      'Message: Container operational',
      'Timestamp: 2025-10-28T12:00:00.000Z',
    ]);
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

    const service = new CloudflareContainerService(namespace);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(service.terminate('ctr-terminate')).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalled();
    expect(namespace.idFromName).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('returns stopped status when DO returns null payload', async () => {
    const { namespace } = createNamespace(async (request) => {
      expect(request.method).toBe('GET');
      expect(new URL(request.url).pathname).toBe('/health');
      return new Response(JSON.stringify({ status: 'healthy' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const service = new CloudflareContainerService(namespace);
    const status = await service.getStatus('ctr-status');

    expect(status).toBe('running');
  });

  it('validates spawn parameters before calling Durable Object', async () => {
    const { namespace, fetchSpy } = createNamespace(
      async () => new Response('OK', { status: 200 }),
    );
    const service = new CloudflareContainerService(namespace);

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
