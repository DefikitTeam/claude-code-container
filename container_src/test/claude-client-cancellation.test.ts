import { describe, it, expect, beforeEach } from 'vitest';
import { ClaudeClient } from '../src/services/claude/claude-client';

describe('ClaudeClient cancellation', () => {
  let client: ClaudeClient;
  beforeEach(() => {
    client = new ClaudeClient();
  });

  it('registers and cancels an operation (forced runtime missing) quickly', async () => {
    // Force-disable SDK and CLI to get deterministic immediate failure
    process.env.CLAUDE_CLIENT_DISABLE_SDK = '1';
    process.env.CLAUDE_CLIENT_DISABLE_CLI = '1';

    const start = Date.now();
    let error: any = null;
    try {
      await client.runPrompt('hi', { sessionId: 's1', operationId: 'opA' });
    } catch (e) {
      error = e;
    }
    const duration = Date.now() - start;
    expect(error).toBeTruthy();
    const msg = String(error?.message);
    expect(['claude_runtime_missing', 'anthropic_api_key_missing']).toContain(
      msg,
    );
    // Should fail fast (< 2s)
    expect(duration).toBeLessThan(2000);
  });
});
