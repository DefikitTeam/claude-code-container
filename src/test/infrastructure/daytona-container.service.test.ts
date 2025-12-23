import { describe, it, expect, vi, afterEach } from 'vitest';
import { DaytonaContainerService } from '../../infrastructure/services/daytona-container.service';

const originalFetch = globalThis.fetch;
const API_URL = 'https://api.daytona.test';
const API_KEY = 'daytona-key';
const BASE_PARAMS = {
  installationId: 'inst-1',
  userId: 'user-1',
  containerImage: 'node:18',
  environmentVariables: { NODE_ENV: 'test' },
  resourceLimits: { cpuMillis: 500, memoryMb: 768, timeoutSeconds: 120 },
};

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

type FetchHandler = (request: Request) => Promise<Response> | Response;

function stubFetch(handler: FetchHandler) {
  const fetchSpy = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const request = new Request(input, init);
    return handler(request);
  });

  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  return fetchSpy;
}

describe('DaytonaContainerService', () => {
  it('reuses a healthy workspace when one exists', async () => {
    const fetchSpy = stubFetch(async (request) => {
      expect(request.method).toBe('GET');
      const url = new URL(request.url);
      expect(url.pathname).toBe('/sandbox');
      // Note: /sandbox doesn't support configId filter, filtering is done client-side

      return new Response(
        JSON.stringify([
          {
            id: 'ws-reuse',
            configId: 'cfg-reuse',
            status: 'running',
            publicUrl: 'https://workspace.reuse',
          },
        ]),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    const service = new DaytonaContainerService(API_URL, API_KEY);
    const result = await service.spawn({ configId: 'cfg-reuse', ...BASE_PARAMS });

    expect(result.containerId).toBe('daytona_ws-reuse');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('creates a new workspace when none exist', async () => {
    const fetchSpy = stubFetch(async (request) => {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/sandbox') {
        return new Response(
          JSON.stringify([]),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (request.method === 'POST' && url.pathname === '/sandbox') {
        return new Response(
          JSON.stringify({
            id: 'ws-new',
            configId: 'cfg-new',
            status: 'creating', // Initial status, not ready yet
            publicUrl: 'https://workspace.new',
          }),
          {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      // Polling endpoint for waitForWorkspaceReady
      if (request.method === 'GET' && url.pathname === '/sandbox/ws-new') {
        return new Response(
          JSON.stringify({
            id: 'ws-new',
            configId: 'cfg-new',
            status: 'running', // Now ready
            publicUrl: 'https://workspace.new',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    });

    const service = new DaytonaContainerService(API_URL, API_KEY);
    const result = await service.spawn({ configId: 'cfg-new', ...BASE_PARAMS });

    expect(result.containerId).toBe('daytona_ws-new');
    // GET /sandbox (list), POST /sandbox (create), GET /sandbox/ws-new (poll for ready)
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('throws when Daytona API returns an error', async () => {
    stubFetch(async (request) => {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/sandbox') {
        return new Response(
          JSON.stringify([]),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      return new Response('Internal failure', {
        status: 500,
        statusText: 'Server Error',
        headers: { 'Content-Type': 'text/plain' },
      });
    });

    const service = new DaytonaContainerService(API_URL, API_KEY);

    await expect(
      service.spawn({ configId: 'cfg-error', ...BASE_PARAMS }),
    ).rejects.toThrow('Daytona API POST /sandbox failed');
  });

  it('forwards exec commands to the Toolbox API endpoint', async () => {
    const fetchSpy = stubFetch(async (request) => {
      const url = new URL(request.url);
      
      // Toolbox API endpoint: /toolbox/{sandboxId}/toolbox/process/execute
      if (request.method === 'POST' && url.pathname === '/toolbox/ws-exec/toolbox/process/execute') {
        const payload = (await request.json()) as { command: string; timeout: number };
        // Verify command is wrapped with bash -c
        expect(payload.command).toContain('bash -c');
        expect(payload.command).toContain('echo hi');
        return new Response(
          JSON.stringify({ exitCode: 0, result: 'echo hi\n' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unexpected request ${request.method} ${request.url}`);
    });

    const service = new DaytonaContainerService(API_URL, API_KEY);
    const result = await service.execute('daytona_ws-exec', 'echo hi');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('echo hi');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // Additional lifecycle tests as per review feedback

  it('getLogs fetches from /sandbox/{id}/logs and handles empty logs', async () => {
    const fetchSpy = stubFetch(async (request) => {
      const url = new URL(request.url);
      expect(request.method).toBe('GET');
      expect(url.pathname).toBe('/sandbox/ws-logs/logs');

      return new Response(
        JSON.stringify({ logs: [] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    const service = new DaytonaContainerService(API_URL, API_KEY);
    const result = await service.getLogs('daytona_ws-logs');

    expect(result).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('terminate issues DELETE /sandbox/{id} successfully', async () => {
    const fetchSpy = stubFetch(async (request) => {
      const url = new URL(request.url);
      expect(request.method).toBe('DELETE');
      expect(url.pathname).toBe('/sandbox/ws-terminate');

      return new Response(null, { status: 204 });
    });

    const service = new DaytonaContainerService(API_URL, API_KEY);
    await service.terminate('daytona_ws-terminate');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('terminate handles 404 gracefully for idempotency', async () => {
    const fetchSpy = stubFetch(async (request) => {
      const url = new URL(request.url);
      expect(request.method).toBe('DELETE');
      expect(url.pathname).toBe('/sandbox/ws-already-gone');

      return new Response('Not Found', {
        status: 404,
        statusText: 'Not Found',
      });
    });

    const service = new DaytonaContainerService(API_URL, API_KEY);
    // Should not throw
    await service.terminate('daytona_ws-already-gone');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('terminate throws on non-404 errors', async () => {
    stubFetch(async () => {
      return new Response('Internal Error', {
        status: 500,
        statusText: 'Server Error',
      });
    });

    const service = new DaytonaContainerService(API_URL, API_KEY);

    await expect(
      service.terminate('daytona_ws-error'),
    ).rejects.toThrow('Daytona API DELETE');
  });

  it('getStatus maps running/ready/started to running', async () => {
    for (const status of ['running', 'ready', 'started']) {
      stubFetch(async () => {
        return new Response(
          JSON.stringify({
            id: 'ws-status',
            configId: 'cfg-status',
            status,
            publicUrl: 'https://workspace.status',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      });

      const service = new DaytonaContainerService(API_URL, API_KEY);
      const result = await service.getStatus('daytona_ws-status');

      expect(result).toBe('running');
    }
  });

  it('getStatus maps terminated/stopped to stopped', async () => {
    for (const status of ['terminated', 'stopped']) {
      stubFetch(async () => {
        return new Response(
          JSON.stringify({
            id: 'ws-status',
            configId: 'cfg-status',
            status,
            publicUrl: 'https://workspace.status',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      });

      const service = new DaytonaContainerService(API_URL, API_KEY);
      const result = await service.getStatus('daytona_ws-status');

      expect(result).toBe('stopped');
    }
  });

  it('getStatus returns error for unexpected status values', async () => {
    stubFetch(async () => {
      return new Response(
        JSON.stringify({
          id: 'ws-status',
          configId: 'cfg-status',
          status: 'unknown-state',
          publicUrl: 'https://workspace.status',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });

    const service = new DaytonaContainerService(API_URL, API_KEY);
    const result = await service.getStatus('daytona_ws-status');

    expect(result).toBe('error');
  });

  it('throws ValidationError for containerId without daytona_ prefix', async () => {
    const service = new DaytonaContainerService(API_URL, API_KEY);

    await expect(service.getLogs('invalid-id')).rejects.toThrow('Invalid Daytona containerId');
    await expect(service.terminate('no-prefix')).rejects.toThrow('Invalid Daytona containerId');
    await expect(service.getStatus('bad-format')).rejects.toThrow('Invalid Daytona containerId');
  });

  it('throws ValidationError for empty containerId', async () => {
    const service = new DaytonaContainerService(API_URL, API_KEY);

    await expect(service.getLogs('')).rejects.toThrow('containerId is required');
    await expect(service.terminate('')).rejects.toThrow('containerId is required');
    await expect(service.getStatus('')).rejects.toThrow('containerId is required');
  });

  it('only reuses workspace matching the provided configId', async () => {
    const fetchSpy = stubFetch(async (request) => {
      const url = new URL(request.url);

      if (request.method === 'GET' && url.pathname === '/sandbox') {
        return new Response(
          JSON.stringify([
            {
              id: 'ws-other',
              configId: 'cfg-other', // Different configId
              status: 'running',
              publicUrl: 'https://workspace.other',
            },
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (request.method === 'POST' && url.pathname === '/sandbox') {
        return new Response(
          JSON.stringify({
            id: 'ws-new-correct',
            configId: 'cfg-target',
            status: 'running',
            publicUrl: 'https://workspace.new',
          }),
          {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (request.method === 'GET' && url.pathname === '/sandbox/ws-new-correct') {
        return new Response(
          JSON.stringify({
            id: 'ws-new-correct',
            configId: 'cfg-target',
            status: 'running',
            publicUrl: 'https://workspace.new',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    });

    const service = new DaytonaContainerService(API_URL, API_KEY);
    // Request workspace for cfg-target, but only cfg-other exists
    const result = await service.spawn({ configId: 'cfg-target', ...BASE_PARAMS });

    // Should create new workspace, not reuse existing one with different configId
    expect(result.containerId).toBe('daytona_ws-new-correct');
    // GET /sandbox (list), POST /sandbox (create), GET /sandbox/ws-new-correct (poll)
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
