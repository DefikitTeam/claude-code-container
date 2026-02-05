
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PromptProcessor } from '../../container_src/src/services/prompt/prompt-processor';
import type { IClaudeService } from '../../container_src/src/core/interfaces/services/claude.service';
import type { ISessionStore } from '../../container_src/src/services/session/session-store';
import type { IWorkspaceService } from '../../container_src/src/services/workspace/workspace-service';
import type { GitService } from '../../container_src/src/services/git/git-service';

describe('Branch Tracking Logic', () => {
  let promptProcessor: PromptProcessor;
  let mockClaudeService: IClaudeService;
  let mockSessionStore: ISessionStore;
  let mockWorkspaceService: IWorkspaceService;
  let mockGitService: GitService;

  beforeEach(() => {
    mockClaudeService = {
      runPrompt: vi.fn().mockResolvedValue({ fullText: 'ok', tokens: { input: 0, output: 0 } }),
    } as unknown as IClaudeService;

    mockSessionStore = {
      load: vi.fn().mockResolvedValue({
        sessionId: 'test-session',
        messageHistory: [],
        agentContext: {},
        sessionOptions: {}
      }),
      save: vi.fn(),
    } as unknown as ISessionStore;

    mockWorkspaceService = {
      prepare: vi.fn().mockResolvedValue({
        path: '/tmp/ws',
        sessionId: 'test-session',
        gitInfo: { currentBranch: 'main' }
      }),
    } as unknown as IWorkspaceService;

    mockGitService = {
      ensureRepo: vi.fn().mockResolvedValue(undefined),
      runGit: vi.fn(),
      checkoutBranch: vi.fn().mockResolvedValue(undefined),
    } as unknown as GitService;

    promptProcessor = new PromptProcessor({
      sessionStore: mockSessionStore,
      workspaceService: mockWorkspaceService,
      claudeClient: mockClaudeService,
      gitService: mockGitService
    });
  });

  it('should create new local branch if remote fetch fails', async () => {
    // Setup context with a specific branch
    const context = {
        repository: {
            owner: 'owner',
            name: 'repo',
            defaultBranch: 'main',
            workingBranch: 'feature/new-branch'
        }
    };

    // Mocks for git operations
    const runGitMock = mockGitService.runGit as any;
    
    // 1. Fetch fails (remote branch missing)
    runGitMock.mockImplementation(async (_path: string, args: string[]) => {
      console.error('MOCK runGit args:', args);
      if (args[0] === 'fetch') {
        // GitService catches exec errors and returns code/stderr
        return { code: 128, stderr: "fatal: couldn't find remote ref" };
      }
      if (args[0] === 'rev-parse' && args.some(a => a.includes('origin/feature/new-branch'))) {
         return { code: 128 }; // Ref not found
      }

      // verify local ref fails (so we trigger creation)
      if (args[0] === 'rev-parse' && args.some(a => a.includes('feature/new-branch')) && !args.some(a => a.includes('origin'))) {
          return { code: 128 }; // Local ref not found
      }

      // Creation
      if (args[0] === 'checkout' && args.includes('-b')) {
          return { code: 0 };
      }
      
      return { code: 0 }; // Default success for other calls
    });

    await promptProcessor.processPrompt({
      sessionId: 'test-session',
      content: [{ type: 'text', text: 'hi' }],
      rawParams: { context }
    });

    // Verification
    // 1. Should have checked out default branch first
    expect(mockGitService.checkoutBranch).toHaveBeenCalledWith('/tmp/ws', 'main');

    // 2. Should have created new branch
    expect(mockGitService.runGit).toHaveBeenCalledWith('/tmp/ws', ['checkout', '-b', 'feature/new-branch']);
  });
});
