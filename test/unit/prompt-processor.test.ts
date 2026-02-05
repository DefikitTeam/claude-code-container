import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PromptProcessor } from '../../container_src/src/services/prompt/prompt-processor';
import type { IClaudeService } from '../../container_src/src/core/interfaces/services/claude.service';
import type { IWorkspaceService } from '../../container_src/src/workspace/workspace-service';
import type { ISessionStore } from '../../container_src/src/session/session-store';

describe('PromptProcessor', () => {
  let promptProcessor: PromptProcessor;
  let mockClaudeService: IClaudeService;
  let mockWorkspaceService: IWorkspaceService;
  let mockSessionStore: ISessionStore;

  beforeEach(() => {
    mockClaudeService = {
      runPrompt: vi.fn().mockResolvedValue({
        fullText: 'response',
        tokens: { input: 10, output: 20 },
      }),
      cancel: vi.fn(),
      cancelOperation: vi.fn(),
    } as unknown as IClaudeService;

    mockWorkspaceService = {
      prepare: vi.fn().mockResolvedValue({
        sessionId: 'test-session',
        path: '/tmp/test-workspace',
        isEphemeral: true,
        createdAt: Date.now(),
      }),
    } as unknown as IWorkspaceService;

    mockSessionStore = {
      load: vi.fn().mockResolvedValue({
        sessionId: 'test-session',
        messageHistory: [],
      }),
      save: vi.fn(),
    } as unknown as ISessionStore;

    promptProcessor = new PromptProcessor({
      claudeClient: mockClaudeService,
      workspaceService: mockWorkspaceService,
      sessionStore: mockSessionStore,
    });
  });

  it('should propagate llmProvider model to claudeClient options', async () => {
    const opts = {
      sessionId: 'test-session',
      content: [{ type: 'text', text: 'hello' }],
      llmProvider: {
        provider: 'openrouter' as const,
        model: 'openai/gpt-5-mini',
        baseURL: 'https://openrouter.ai/api/v1',
      },
    };

    await promptProcessor.processPrompt(opts as any);

    expect(mockClaudeService.runPrompt).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        model: 'openai/gpt-5-mini',
        llmProvider: expect.objectContaining({
          model: 'openai/gpt-5-mini',
        }),
      }),
      expect.anything()
    );
  });

  it('should use default model if llmProvider model is missing', async () => {
    const opts = {
        sessionId: 'test-session',
        content: [{ type: 'text', text: 'hello' }],
        // No llmProvider
      };
  
      await promptProcessor.processPrompt(opts as any);
  
      // Should NOT have 'model' property in the call options if it wasn't passed,
      // allowing RuntimeSelector to apply its default.
      // OR it might be undefined. Let's verify it matches what we passed.
      
      const callArgs = (mockClaudeService.runPrompt as any).mock.calls[0][1];
      expect(callArgs.model).toBeUndefined();
  });

  it('should include full content in session/update notifications', async () => {
    const opts = {
      sessionId: 'test-session',
      content: [{ type: 'text', text: 'hello' }],
      notificationSender: vi.fn(),
    };

    // Mock runPrompt to trigger onDelta
    (mockClaudeService.runPrompt as any).mockImplementation(async (prompt, options, callbacks) => {
      callbacks.onDelta({ text: 'chunk1', tokens: 1 });
      callbacks.onDelta({ text: 'chunk2', tokens: 1 });
      return { fullText: 'chunk1chunk2' };
    });

    await promptProcessor.processPrompt(opts as any);

    expect(opts.notificationSender).toHaveBeenCalledWith(
      'session/update',
      expect.objectContaining({
        delta: 'chunk2',
        content: [{ type: 'text', text: 'chunk1chunk2' }],
      })
    );
  });
});
