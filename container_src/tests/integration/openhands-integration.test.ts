import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import OpenHandsAdapter from '../../src/infrastructure/ai/openhands.adapter.js';

describe('OpenHands integration (REST polling simulated)', () => {
  let fetchMock: any;

  beforeEach(() => {
    fetchMock = vi.fn();
    // @ts-ignore
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('completes a conversation flow via polling', async () => {
    const convResp = { id: 'conv-int-1', status: 'pending' };
    const statusResp1 = {
      id: 'conv-int-1',
      status: 'in_progress',
      events: [{ id: 'e1', message: 'part1 ' }],
    };
    const statusResp2 = {
      id: 'conv-int-1',
      status: 'completed',
      summary: 'part1 part2',
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

    const result = await adapter.run(
      'integration test',
      { model: 'm' } as any,
      {} as any,
      callbacks,
      new AbortController().signal,
    );

    expect(onStart).toHaveBeenCalledOnce || expect(onStart).toHaveBeenCalled();
    expect(onDelta).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalled();
    expect(result.fullText).toContain('part1');
  });
});
