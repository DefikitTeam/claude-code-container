import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import OpenHandsAdapter from '../../src/infrastructure/ai/openhands.adapter.js';

describe('OpenHandsAdapter (partial integration via fetch mocks)', () => {
  let fetchMock: any;

  beforeEach(() => {
    fetchMock = vi.fn();
    // @ts-ignore
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls callbacks (onStart, onDelta, onComplete) when conversation completes', async () => {
    // createConversation -> returns id
    const convResp = { id: 'conv-abc', status: 'pending' };
    // first status poll returns one event
    const statusResp1 = {
      id: 'conv-abc',
      status: 'in_progress',
      events: [{ id: 'ev1', message: 'hello ' }],
    };
    // second poll returns completed with summary
    const statusResp2 = {
      id: 'conv-abc',
      status: 'completed',
      summary: 'hello world',
    };

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(convResp),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(statusResp1),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(statusResp2),
      });

    const adapter = new OpenHandsAdapter({
      baseUrl: 'https://api.test',
      apiKey: 'sk-test',
      pollingIntervalMs: 10,
      maxRetries: 1,
    });

    const onStart = vi.fn();
    const onDelta = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();

    const callbacks = { onStart, onDelta, onComplete, onError } as any;
    const abortController = new AbortController();

    const result = await adapter.run(
      'do thing',
      { model: 'test' } as any,
      {} as any,
      callbacks,
      abortController.signal,
    );

    expect(onStart).toHaveBeenCalled();
    expect(onDelta).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(result.fullText).toBeDefined();
  });
});
