import { SessionStore } from '../services/session/session-store.js';
import { WorkspaceService } from '../services/workspace/workspace-service.js';
import { GitService } from '../services/git/git-service.js';
import { PromptProcessor } from '../services/prompt/prompt-processor.js';
import { claudeClientSingleton } from '../services/claude/claude-client.js';
import { GitHubAutomationService } from '../infrastructure/github/github-automation.service.js';
import type { ISessionStore } from '../services/session/session-store.js';
import type { IWorkspaceService } from '../services/workspace/workspace-service.js';
import type { IGitHubAutomationService } from '../core/interfaces/services/github-automation.service.js';
import type { IClaudeService } from '../core/interfaces/services/claude.service.js';

export interface Container {
  sessionStore: ISessionStore;
  workspaceService: IWorkspaceService;
  gitService: GitService;
  githubAutomationService: IGitHubAutomationService;
  promptProcessor: PromptProcessor;
  claudeClient: IClaudeService;
}

let cachedContainer: Container | null = null;

export function createContainer(): Container {
  const sessionStore = new SessionStore();
  const workspaceService = new WorkspaceService();
  const gitService = new GitService();
  const claudeClient: IClaudeService = claudeClientSingleton;
  const githubAutomationService = new GitHubAutomationService({
    gitService,
  });

  const promptProcessor = new PromptProcessor({
    sessionStore,
    workspaceService,
    claudeClient,
    gitService,
    githubAutomationService,
  });

  return {
    sessionStore,
    workspaceService,
    gitService,
    githubAutomationService,
    promptProcessor,
    claudeClient,
  };
}

export function getContainer(): Container {
  if (!cachedContainer) {
    cachedContainer = createContainer();
  }
  return cachedContainer;
}

export function resetContainer(): void {
  cachedContainer = null;
}
