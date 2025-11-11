import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHttpServer } from '../src/api/http/server.js';

function request(
  options: http.RequestOptions & { body?: Record<string, unknown> | string },
): Promise<{ status: number; body: string }> {
  const { body, ...rest } = options;
  const payload =
    typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined;

  return new Promise((resolve, reject) => {
    const req = http.request(rest, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode || 0, body: data });
      });
    });
    req.on('error', reject);

    if (payload) {
      req.setHeader('Content-Type', 'application/json');
      req.write(payload);
    }

    req.end();
  });
}

describe('HTTP server (modular)', () => {
  let server: http.Server;
  let basePort: number;

  beforeAll(async () => {
    vi.stubEnv('CLAUDE_HTTP_SKIP_CLI_CHECK', '1');
    server = createHttpServer();
    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve());
      server.on('error', reject);
    });
    basePort = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    vi.unstubAllEnvs();
  });

  it('reports health status', async () => {
    const res = await request({
      hostname: '127.0.0.1',
      port: basePort,
      path: '/health',
      method: 'GET',
    });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.status).toBe('degraded');
    expect(typeof parsed.apiKeyAvailable).toBe('boolean');
    expect(parsed.runtimeFlags).toMatchObject({
      disableSdk: expect.any(Boolean),
      disableCli: expect.any(Boolean),
    });
  });

  it('returns JSON-RPC parse error for malformed payloads', async () => {
    const res = await request({
      hostname: '127.0.0.1',
      port: basePort,
      path: '/acp',
      method: 'POST',
      body: '{invalid}',
    });

    expect(res.status).toBe(400);
    const parsed = JSON.parse(res.body);
    expect(parsed).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
    });
  });

  it('returns method not found for unsupported ACP method', async () => {
    const res = await request({
      hostname: '127.0.0.1',
      port: basePort,
      path: '/acp',
      method: 'POST',
      body: {
        jsonrpc: '2.0',
        id: '1',
        method: 'unknown/method',
      },
    });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed).toMatchObject({
      jsonrpc: '2.0',
      error: { code: -32601 },
    });
  });

  it('process route echoes success payload', async () => {
    const res = await request({
      hostname: '127.0.0.1',
      port: basePort,
      path: '/process',
      method: 'POST',
      body: { type: 'smoke-test' },
    });

    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed).toMatchObject({
      success: true,
      message: 'Request processed successfully',
    });
    expect(parsed.logs).toEqual(['Processed request of type: smoke-test']);
  });
});
