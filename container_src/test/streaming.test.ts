import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import postToBroker from '../src/api/utils/streaming.js';

describe('postToBroker', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.STREAM_BROKER_URL;
    delete process.env.STREAM_BROKER_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should no-op when stream broker is not configured', async () => {
    global.fetch = vi.fn();
    await postToBroker('sess-123', { message: 'test' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should POST to broker using STREAM_BROKER_KEY when configured', async () => {
    process.env.STREAM_BROKER_URL = 'http://localhost:3000';
    process.env.STREAM_BROKER_KEY = 'dev-stream-key';

    (global.fetch as any) = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const envelope = { foo: 'bar' };
    await postToBroker('sess-1', envelope);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/streams/sessions/sess-1/events');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer dev-stream-key');
    expect(opts.headers['X-Stream-Key']).toBe('dev-stream-key');
    expect(JSON.parse(opts.body)).toEqual(envelope);
  });

  it('should update metrics on success', async () => {
    process.env.STREAM_BROKER_URL = 'http://localhost:3000';
    process.env.STREAM_BROKER_KEY = 'dev-stream-key';
    (global.fetch as any) = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const initial = (await import('../src/api/utils/streaming.js')).postToBrokerMetrics.totalPosts;
    await postToBroker('sess-metrics', { foo: 'bar' });
    const m = (await import('../src/api/utils/streaming.js')).postToBrokerMetrics;
    expect(m.totalPosts).toBeGreaterThan(initial);
    expect(m.success).toBeGreaterThan(0);
  });

  it('should prefer provided token over config key', async () => {
    process.env.STREAM_BROKER_URL = 'http://localhost:3000';
    process.env.STREAM_BROKER_KEY = 'dev-stream-key';

    (global.fetch as any) = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const envelope = { foo: 'bar' };
    await postToBroker('sess-2', envelope, 'ephemeral-token');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = (global.fetch as any).mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer ephemeral-token');
    expect(opts.headers['X-Stream-Key']).toBe('ephemeral-token');
  });

  it('should retry on network errors and eventually succeed', async () => {
    process.env.STREAM_BROKER_URL = 'http://localhost:3000';
    process.env.STREAM_BROKER_KEY = 'dev-stream-key';

    // Simulate: reject -> non-ok -> ok
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server error' })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    (global.fetch as any) = mockFetch;

    vi.useFakeTimers();

    const p = postToBroker('sess-3', { delta: 1 }, undefined, {
      maxRetries: 3,
      initialBackoffMs: 10,
    });

    // Allow the promise to progress through retries
    // run timers enough to cover backoffs (10 + 20)
    await vi.runAllTimersAsync();

    await p;
    expect(mockFetch).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
