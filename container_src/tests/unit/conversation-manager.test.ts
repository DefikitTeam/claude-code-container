import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ConversationManager from '../../src/services/openhands/conversation-manager.js';

describe('ConversationManager', () => {
  let fetchMock: any;

  beforeEach(() => {
    fetchMock = vi.fn();
    // @ts-ignore - stub global fetch
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('createConversation posts to /api/conversations and returns parsed response', async () => {
    const resp = { id: 'conv-123', status: 'pending' };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify(resp),
    });
    const cm = new ConversationManager({
      baseUrl: 'https://api.test',
      apiKey: 'sk-test',
    });
    const result = await cm.createConversation({ prompt: 'hello' });
    expect(result.id).toBe('conv-123');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('getConversationStatus includes latest_event_id query when provided', async () => {
    const resp = { id: 'conv-1', status: 'in_progress' };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify(resp),
    });
    const cm = new ConversationManager({
      baseUrl: 'https://api.test',
      apiKey: 'sk-test',
    });
    const result = await cm.getConversationStatus('conv-1', 5);
    expect(result.status).toBe('in_progress');
    // verify fetch called with URL containing latest_event_id=5
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('latest_event_id=5');
  });
});
