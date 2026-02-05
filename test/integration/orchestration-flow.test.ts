
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PromptProcessor } from '../../container_src/src/services/prompt/prompt-processor';
import type { IClaudeService } from '../../container_src/src/core/interfaces/services/claude.service';
import type { ISessionStore } from '../../container_src/src/services/session/session-store';
import type { IWorkspaceService } from '../../container_src/src/services/workspace/workspace-service';
import { EXECUTOR_SYSTEM_PROMPT } from '../../container_src/src/core/prompts/prompt-utils';
import type { ACPSession } from '../../container_src/src/types/acp-session';

describe('Orchestration Flow Integration', () => {
  let promptProcessor: PromptProcessor;
  let mockClaudeService: IClaudeService;
  let mockSessionStore: ISessionStore;
  let mockWorkspaceService: IWorkspaceService;
  let mockSession: ACPSession;

  beforeEach(() => {
    mockSession = {
      sessionId: 'test-session',
      workspaceUri: 'file:///tmp/test-workspace',
      mode: 'development',
      state: 'active',
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      messageHistory: [],
      sessionOptions: {
        persistHistory: false,
      },
      agentContext: {}
    };

    // Mock dependencies
    mockClaudeService = {
      runPrompt: vi.fn().mockResolvedValue({
        fullText: 'Mock response',
        tokens: { input: 10, output: 20 },
        stopReason: 'stop',
        toolUse: []
      }),
      streamPrompt: vi.fn(),
    } as unknown as IClaudeService;

    mockSessionStore = {
      load: vi.fn().mockResolvedValue(mockSession), // Return valid session
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as ISessionStore;

    mockWorkspaceService = {
      prepare: vi.fn().mockResolvedValue({
        path: '/tmp/test-workspace',
        sessionId: 'test-session',
        isEphemeral: true,
      }),
    } as unknown as IWorkspaceService;

    // Instantiate PromptProcessor
    promptProcessor = new PromptProcessor({
      sessionStore: mockSessionStore,
      workspaceService: mockWorkspaceService,
      claudeClient: mockClaudeService,
    });
  });

  it('should inject EXECUTOR_SYSTEM_PROMPT when agentRole is executor', async () => {
    const agentContext = {
      agentRole: 'executor',
      requestingAgent: 'orchestrator',
      planId: 'plan-123',
      stepId: 'step-1',
      subTask: 'Implement validation',
    };

    await promptProcessor.processPrompt({
      sessionId: 'test-session',
      content: [{ type: 'text', text: 'Do the task' }],
      agentContext,
      operationId: 'op-1',
      session: mockSession // Pass session explicitly
    });

    expect(mockClaudeService.runPrompt).toHaveBeenCalled();
    const [promptArg, optionsArg] = (mockClaudeService.runPrompt as any).mock.calls[0];
    
    // Verify prompt contains Executor System Prompt
    expect(promptArg).toContain(EXECUTOR_SYSTEM_PROMPT);
    expect(promptArg).toContain('Requesting Agent: orchestrator');
    expect(promptArg).toContain('Assigned Sub-Task: Implement validation');
  });

  it('should NOT inject EXECUTOR_SYSTEM_PROMPT when agentRole is undefined', async () => {
    await promptProcessor.processPrompt({
      sessionId: 'test-session',
      content: [{ type: 'text', text: 'Do existing task' }],
      operationId: 'op-2',
      session: mockSession // Pass session explicitly
      // No agentContext
    });

    expect(mockClaudeService.runPrompt).toHaveBeenCalled();
    const [promptArg] = (mockClaudeService.runPrompt as any).mock.calls[0];
    
    // Verify prompt does NOT contain Executor System Prompt
    expect(promptArg).not.toContain(EXECUTOR_SYSTEM_PROMPT);
  });

  it('should pass correct LLM provider config to Claude service', async () => {
    const llmProvider = {
      provider: 'local-glm' as const,
      model: 'glm-4.7-flash',
      baseURL: 'http://localhost:8000',
    };

    await promptProcessor.processPrompt({
      sessionId: 'test-session',
      content: [{ type: 'text', text: 'Hello' }],
      operationId: 'op-3',
      llmProvider,
      session: mockSession // Pass session explicitly
    });

    expect(mockClaudeService.runPrompt).toHaveBeenCalled();
    const [_, optionsArg] = (mockClaudeService.runPrompt as any).mock.calls[0];

    // Verify LLM provider is passed through
    expect(optionsArg.llmProvider).toEqual(llmProvider);
  });
});
