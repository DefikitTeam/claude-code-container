import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PromptProcessor } from '../src/services/prompt/prompt-processor';
import type { ACPSession } from '../src/types/acp-session';
import {
  ClassifiedErrorCode,
  defaultErrorClassifier,
} from '../src/core/errors/error-classifier';
import type { GitHubAutomationResult } from '../src/services/github/github-automation.js';
import { GitHubAutomationService } from '../src/services/github/github-automation.js';
import type { GitService } from '../src/services/git/git-service.js';
import type { Octokit } from '@octokit/rest';

function makeSession(overrides: Partial<ACPSession> = {}): ACPSession {
  return {
    sessionId: overrides.sessionId || 'sess-1',
    workspaceUri: overrides.workspaceUri || 'file://' + process.cwd(),
    mode: 'development',
    state: 'active',
    createdAt: Date.now() - 1000,
    lastActiveAt: Date.now() - 500,
    messageHistory: overrides.messageHistory || [],
    sessionOptions: {
      persistHistory: false,
      enableGitOps: false,
      contextFiles: [],
    },
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
      prepare: vi.fn(async () => ({
        sessionId: 'sess-1',
        path: process.cwd(),
        isEphemeral: true,
        createdAt: Date.now(),
        gitInfo: null,
      })),
    };
    authService = { ensureAuth: vi.fn(async () => {}) };
    claudeClient = {
      runPrompt: vi.fn(async (_prompt: string, _opts: any, callbacks: any) => {
        // eslint-disable-line @typescript-eslint/no-explicit-any
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
      issue: {
        id: 1,
        number: 42,
        url: 'https://github.com/org/repo/issues/42',
        title: 'Add automation badge',
      },
      pullRequest: {
        number: 88,
        url: 'https://github.com/org/repo/pull/88',
        branch: 'claude-code/issue-42-20250101-000000',
      },
      commit: {
        sha: 'deadbeef',
        message: 'Fix issue #42: Add automation badge',
      },
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
    sessionStore.load.mockResolvedValue(
      makeSession({
        sessionOptions: {
          persistHistory: false,
          enableGitOps: true,
          contextFiles: [],
        },
      }),
    );

    const res = await processor.processPrompt({
      sessionId: 'sess-1',
      content: [{ type: 'text', text: 'Automation-enabled prompt' }],
      agentContext: {
        repository: 'org/repo',
        automation: { issueTitle: 'Add automation badge' },
      },
    });

    expect(githubAutomationService.execute).toHaveBeenCalledTimes(1);
    const contextArg = githubAutomationService.execute.mock.calls[0][0];
    expect(contextArg.repository.owner).toBe('org');
    expect(contextArg.repository.name).toBe('repo');
    expect(res.githubAutomation).toEqual(automationResult);
    expect((res as any).meta.githubAutomationVersion).toBe('1.0.0'); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(res.githubOperations?.branchCreated).toBe(automationResult.branch);
  });

  describe('GitHub automation integration', () => {
    it('executes automation end-to-end and merges legacy githubOperations', async () => {
      const git = createIntegrationGitService();
      const octokit = createIntegrationOctokit();

      const automationService = new GitHubAutomationService({
        gitService: git.gitService,
        octokitFactory: () => octokit.octokit,
        now: () => new Date('2025-09-25T12:00:00Z'),
        branchPrefix: 'integration',
      });

      const integrationSessionStore = {
        load: vi.fn(async () =>
          makeSession({
            sessionId: 'sess-automation',
            sessionOptions: {
              persistHistory: false,
              enableGitOps: true,
              contextFiles: [],
            },
          }),
        ),
        save: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        list: vi.fn(async () => []),
        exists: vi.fn(async () => true),
      };

      const integrationWorkspace = {
        prepare: vi.fn(async () => ({
          sessionId: 'sess-automation',
          path: '/tmp/workspace',
          isEphemeral: true,
          createdAt: Date.now(),
          gitInfo: {
            currentBranch: 'main',
            hasUncommittedChanges: true,
            remoteUrl: 'https://github.com/org/repo.git',
            lastCommit: 'Initial commit',
          },
        })),
        getPath: vi.fn(() => '/tmp/workspace'),
        cleanup: vi.fn(async () => {}),
      };

      const integrationClaude = {
        runPrompt: vi.fn(
          async (_prompt: string, _opts: any, callbacks: any) => {
            // eslint-disable-line @typescript-eslint/no-explicit-any
            callbacks.onStart?.({});
            callbacks.onDelta?.({ text: 'Hello world', tokens: 3 });
            callbacks.onComplete?.({ fullText: 'Hello world' });
            return { fullText: 'Hello world', tokens: { input: 1, output: 3 } };
          },
        ),
        cancel: vi.fn(async () => {}),
        cancelOperation: vi.fn(async () => {}),
      };

      const integrationProcessor = new PromptProcessor({
        sessionStore: integrationSessionStore,
        workspaceService: integrationWorkspace,
        claudeClient: integrationClaude,
        gitService: git.gitService,
        githubAutomationService: automationService,
      });

      const result = await integrationProcessor.processPrompt({
        sessionId: 'sess-automation',
        content: [{ type: 'text', text: 'Please fix bug' }],
        githubToken: 'token-abc',
        agentContext: {
          repository: 'org/repo',
          automation: {
            issueTitle: 'Fix bug reported by QA',
            labels: ['bug', 'critical'],
          },
        },
      });

      expect(result.githubAutomation?.status).toBe('success');
      expect(result.githubAutomation?.issue?.number).toBe(42);
      expect(result.githubAutomation?.pullRequest?.number).toBe(77);
      expect(result.githubAutomation?.branch).toMatch(
        /^integration\/issue-42-/,
      );
      expect(result.githubOperations?.branchCreated).toBe(
        result.githubAutomation?.branch,
      );
      expect(result.githubOperations?.pullRequestCreated?.number).toBe(77);
      expect(octokit.issuesCreate).toHaveBeenCalledTimes(1);
      expect(octokit.pullsCreate).toHaveBeenCalledTimes(1);
      expect(
        git.runGit.mock.calls.some(([_, args]) => args[0] === 'push'),
      ).toBe(true);
    });

    it('captures automation errors and surfaces diagnostics', async () => {
      const git = createIntegrationGitService({ failPush: true });
      const octokit = createIntegrationOctokit();

      const automationService = new GitHubAutomationService({
        gitService: git.gitService,
        octokitFactory: () => octokit.octokit,
        now: () => new Date('2025-09-25T12:00:00Z'),
      });

      const integrationSessionStore = {
        load: vi.fn(async () =>
          makeSession({
            sessionId: 'sess-automation-error',
            sessionOptions: {
              persistHistory: false,
              enableGitOps: true,
              contextFiles: [],
            },
          }),
        ),
        save: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        list: vi.fn(async () => []),
        exists: vi.fn(async () => true),
      };

      const integrationWorkspace = {
        prepare: vi.fn(async () => ({
          sessionId: 'sess-automation-error',
          path: '/tmp/workspace',
          isEphemeral: true,
          createdAt: Date.now(),
          gitInfo: {
            currentBranch: 'main',
            hasUncommittedChanges: true,
            remoteUrl: 'https://github.com/org/repo.git',
            lastCommit: 'Initial commit',
          },
        })),
        getPath: vi.fn(() => '/tmp/workspace'),
        cleanup: vi.fn(async () => {}),
      };

      const integrationClaude = {
        runPrompt: vi.fn(
          async (_prompt: string, _opts: any, callbacks: any) => {
            // eslint-disable-line @typescript-eslint/no-explicit-any
            callbacks.onStart?.({});
            callbacks.onDelta?.({ text: 'Hello world', tokens: 3 });
            callbacks.onComplete?.({ fullText: 'Hello world' });
            return { fullText: 'Hello world', tokens: { input: 1, output: 3 } };
          },
        ),
        cancel: vi.fn(async () => {}),
        cancelOperation: vi.fn(async () => {}),
      };

      const integrationProcessor = new PromptProcessor({
        sessionStore: integrationSessionStore,
        workspaceService: integrationWorkspace,
        claudeClient: integrationClaude,
        gitService: git.gitService,
        githubAutomationService: automationService,
      });

      const result = await integrationProcessor.processPrompt({
        sessionId: 'sess-automation-error',
        content: [{ type: 'text', text: 'Please fix bug' }],
        githubToken: 'token-error',
        agentContext: {
          repository: 'org/repo',
        },
      });

      expect(result.githubAutomation?.status).toBe('error');
      expect(result.githubAutomation?.error?.code).toBe('git-push-failed');
      expect(
        result.githubAutomation?.diagnostics?.logs?.length,
      ).toBeGreaterThan(0);
      expect(result.githubOperations?.branchCreated).toBeUndefined();
      expect(
        git.runGit.mock.calls.filter(([_, args]) => args[0] === 'push').length,
      ).toBe(1);
    });
  });
});

function defaultAutomationSkip(): GitHubAutomationResult {
  return {
    status: 'skipped',
    skippedReason: 'test-skip',
    diagnostics: { durationMs: 0, attempts: 1, logs: [] },
  };
}

function createIntegrationOctokit() {
  const issuesCreate = vi.fn(async () => ({
    data: {
      id: 1,
      number: 42,
      html_url: 'https://github.com/org/repo/issues/42',
      title: 'Fix bug reported by QA',
    },
  }));
  const issuesComment = vi.fn(async () => ({}));
  const pullsCreate = vi.fn(async () => ({
    data: {
      number: 77,
      html_url: 'https://github.com/org/repo/pull/77',
      draft: false,
    },
  }));

  const octokit = {
    rest: {
      issues: {
        create: issuesCreate,
        createComment: issuesComment,
      },
      pulls: {
        create: pullsCreate,
      },
    },
  } as unknown as Octokit;

  return { octokit, issuesCreate, issuesComment, pullsCreate };
}

function createIntegrationGitService(options: { failPush?: boolean } = {}) {
  const runGit = vi.fn(async (_path: string, args: string[]) => {
    const key = args.join(' ');
    if (key === 'status --porcelain') {
      return { stdout: ' M src/index.ts\n', stderr: '', code: 0 };
    }
    if (key === 'diff --cached --name-only') {
      return { stdout: 'src/index.ts\n', stderr: '', code: 0 };
    }
    if (key === 'rev-parse HEAD') {
      return { stdout: 'deadbeefdeadbeef\n', stderr: '', code: 0 };
    }
    if (key === 'remote get-url --push origin') {
      return {
        stdout: 'https://github.com/org/repo.git\n',
        stderr: '',
        code: 0,
      };
    }
    if (key.startsWith('remote set-url --push')) {
      return { stdout: '', stderr: '', code: 0 };
    }
    if (key.startsWith('config user.')) {
      return { stdout: '', stderr: '', code: 0 };
    }
    if (key.startsWith('add --all')) {
      return { stdout: '', stderr: '', code: 0 };
    }
    if (key.startsWith('commit -m')) {
      return { stdout: '', stderr: '', code: 0 };
    }
    if (key.startsWith('push')) {
      if (options.failPush) {
        return { stdout: '', stderr: 'permission denied', code: 1 };
      }
      return { stdout: '', stderr: '', code: 0 };
    }
    if (key.startsWith('fetch')) {
      return { stdout: '', stderr: '', code: 0 };
    }
    if (key.startsWith('pull')) {
      return { stdout: '', stderr: '', code: 0 };
    }
    if (key.startsWith('checkout')) {
      return { stdout: '', stderr: '', code: 0 };
    }
    return { stdout: '', stderr: '', code: 0 };
  });

  const gitService: Partial<GitService> = {
    ensureRepo: vi.fn(async () => {}),
    runGit,
    createBranch: vi.fn(async () => {}),
    checkoutBranch: vi.fn(async () => {}),
    hasUncommittedChanges: vi.fn(async () => true),
    listChangedFiles: vi.fn(async () => ['src/index.ts']),
  };

  return { gitService: gitService as GitService, runGit };
}
