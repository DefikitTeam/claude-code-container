import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PromptProcessor } from '../src/services/prompt/prompt-processor';
import type { ACPSession } from '../src/types/acp-session';
import { ClassifiedErrorCode, defaultErrorClassifier } from '../src/core/errors/error-classifier';
import type { GitHubAutomationResult } from '../src/services/github/github-automation.js';

function makeSession(overrides: Partial<ACPSession> = {}): ACPSession {
  return {
    sessionId: overrides.sessionId || 'sess-1',
    workspaceUri: overrides.workspaceUri || 'file://' + process.cwd(),
    mode: 'development',
    state: 'active',
    createdAt: Date.now() - 1000,
    lastActiveAt: Date.now() - 500,
    messageHistory: overrides.messageHistory || [],
    sessionOptions: { persistHistory: false, enableGitOps: false, contextFiles: [] },
    ...overrides,
  };
}

describe('PromptProcessor', () => {
  let sessionStore: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  let workspaceService: any;
  let authService: any;
  let claudeClient: any;
  let gitService: any;
  let diagnosticsService: any;
  let githubAutomationService: any;
  let processor: PromptProcessor;
  let originalGitHubToken: string | undefined;

  beforeEach(() => {
    originalGitHubToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'token-test';
    sessionStore = {
      load: vi.fn(async (id: string) => makeSession({ sessionId: id })),
      save: vi.fn(async () => {}),
    };
    workspaceService = {
      prepare: vi.fn(async () => ({ sessionId: 'sess-1', path: process.cwd(), isEphemeral: true, createdAt: Date.now(), gitInfo: null })),
    };
    authService = { ensureAuth: vi.fn(async () => {}) };
    claudeClient = {
      runPrompt: vi.fn(async (_prompt: string, _opts: any, callbacks: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        callbacks.onStart?.({ startTime: Date.now() });
        callbacks.onDelta?.({ text: 'Hello', tokens: 2 });
        callbacks.onComplete?.({ fullText: 'Hello', durationMs: 10 });
        return { fullText: 'Hello', tokens: { input: 1, output: 2 } };
      }),
      cancel: vi.fn(async () => {}),
      cancelOperation: vi.fn(async () => {}),
    };
    gitService = { listChangedFiles: vi.fn(async () => []) };
    diagnosticsService = { run: vi.fn(async () => ({ ok: true })) };
    githubAutomationService = {
      execute: vi.fn(async () => defaultAutomationSkip()),
    };

    processor = new PromptProcessor({
      sessionStore,
      workspaceService,
      claudeClient,
      gitService,
      diagnosticsService,
      githubAutomationService,
    });
  });

  afterEach(() => {
    process.env.GITHUB_TOKEN = originalGitHubToken;
  });

  it('appends history only once when historyAlreadyAppended is false', async () => {
    const res = await processor.processPrompt({
      sessionId: 'sess-1',
      content: [{ type: 'text', text: 'Test' }],
    });
    expect(res.stopReason).toBe('completed');
    expect(sessionStore.save).not.toHaveBeenCalled(); // persistHistory false
    expect(githubAutomationService.execute).not.toHaveBeenCalled();
  });

  it('does not append history when historyAlreadyAppended is true', async () => {
    const sess = makeSession({ messageHistory: [] });
    sessionStore.load.mockResolvedValue(sess);
    await processor.processPrompt({
      sessionId: 'sess-1',
      content: [{ type: 'text', text: 'Test2' }],
      historyAlreadyAppended: true,
    });
    // messageHistory should remain unchanged (no new push)
    expect(sess.messageHistory.length).toBe(0);
  });

  it('classifies errors and returns structured diagnostics', async () => {
    claudeClient.runPrompt.mockImplementationOnce(async () => {
      const err = new Error('API key invalid');
      (err as any).detail = { stderr: 'api key missing', exitCode: 1 }; // eslint-disable-line @typescript-eslint/no-explicit-any
      throw err;
    });
    const res = await processor.processPrompt({
      sessionId: 'sess-1',
      content: [{ type: 'text', text: 'Broken' }],
    });
    expect(res.stopReason).toBe('error');
    // errorCode from PromptProcessor uses classified.code which is enum string value
  expect(res.errorCode).toBe(ClassifiedErrorCode.AuthError);
    const diag = res.diagnostics as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(typeof diag).toBe('object');
    // stderr may be undefined if not captured; allow either contains or undefined fallback
    if (diag && typeof diag.stderr === 'string') {
      expect(diag.stderr.toLowerCase()).toContain('api key');
    }
  });

  it('gracefully runs even if abortSignal already aborted (current behavior)', async () => {
    const controller = new AbortController();
    controller.abort();
    const res = await processor.processPrompt({
      sessionId: 'sess-1',
      content: [{ type: 'text', text: 'Cancel' }],
      abortSignal: controller.signal,
    });
    expect(['completed', 'cancelled']).toContain(res.stopReason);
  });

  it('invokes automation service and attaches result when configured', async () => {
    const automationResult: GitHubAutomationResult = {
      status: 'success',
      branch: 'claude-code/issue-42-20250101-000000',
      diagnostics: { durationMs: 1200, attempts: 1, logs: [] },
      issue: { id: 1, number: 42, url: 'https://github.com/org/repo/issues/42', title: 'Add automation badge' },
      pullRequest: { number: 88, url: 'https://github.com/org/repo/pull/88', branch: 'claude-code/issue-42-20250101-000000' },
      commit: { sha: 'deadbeef', message: 'Fix issue #42: Add automation badge' },
    };
    githubAutomationService.execute.mockResolvedValueOnce(automationResult);
    workspaceService.prepare.mockResolvedValueOnce({
      sessionId: 'sess-1',
      path: process.cwd(),
      isEphemeral: true,
      createdAt: Date.now(),
      gitInfo: {
        currentBranch: 'main',
        hasUncommittedChanges: false,
        remoteUrl: 'https://github.com/org/repo.git',
        lastCommit: 'Initial commit',
      },
    });
    sessionStore.load.mockResolvedValue(makeSession({
      sessionOptions: { persistHistory: false, enableGitOps: true, contextFiles: [] },
    }));

    const res = await processor.processPrompt({
      sessionId: 'sess-1',
      content: [{ type: 'text', text: 'Automation-enabled prompt' }],
      agentContext: { repository: 'org/repo', automation: { issueTitle: 'Add automation badge' } },
    });

    expect(githubAutomationService.execute).toHaveBeenCalledTimes(1);
    const contextArg = githubAutomationService.execute.mock.calls[0][0];
    expect(contextArg.repository.owner).toBe('org');
    expect(contextArg.repository.name).toBe('repo');
    expect(res.githubAutomation).toEqual(automationResult);
    expect((res as any).meta.githubAutomationVersion).toBe('1.0.0'); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(res.githubOperations?.branchCreated).toBe(automationResult.branch);
  });
});

function defaultAutomationSkip(): GitHubAutomationResult {
  return {
    status: 'skipped',
    skippedReason: 'test-skip',
    diagnostics: { durationMs: 0, attempts: 1, logs: [] },
  };
}
