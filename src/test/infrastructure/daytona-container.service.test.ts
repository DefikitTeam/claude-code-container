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
            status: 'ready',
            publicUrl: 'https://workspace.new',
          }),
          {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    });

    const service = new DaytonaContainerService(API_URL, API_KEY);
    const result = await service.spawn({ configId: 'cfg-new', ...BASE_PARAMS });

    expect(result.containerId).toBe('daytona_ws-new');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/sandbox'),
      expect.anything(),
    );
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

  it('forwards exec commands to the workspace endpoint', async () => {
    const fetchSpy = stubFetch(async (request) => {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/sandbox/ws-exec') {
        return new Response(
          JSON.stringify({
            id: 'ws-exec',
            configId: 'cfg-exec',
            status: 'running',
            ports: { '8080': 'https://workspace.exec' },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (url.origin === 'https://workspace.exec') {
        const payload = (await request.json()) as { command: string };
        expect(payload.command).toBe('echo hi');
        return new Response(
          JSON.stringify({ success: true, logs: ['echo hi'] }),
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
    expect(result.stdout).toBe('echo hi');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
