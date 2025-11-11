import { getContainer } from './container.config.js';
import type { ISessionStore } from '../services/session/session-store.js';
import type { IWorkspaceService } from '../services/workspace/workspace-service.js';
import type { GitService } from '../services/git/git-service.js';
import type { IGitHubAutomationService } from '../core/interfaces/services/github-automation.service.js';
import type { PromptProcessor } from '../services/prompt/prompt-processor.js';
import type { IClaudeService } from '../core/interfaces/services/claude.service.js';
import type { Container } from './container.config.js';

export interface RuntimeServices {
  sessionStore: ISessionStore;
  workspaceService: IWorkspaceService;
  gitService: GitService;
  githubAutomationService: IGitHubAutomationService;
  claudeClient: IClaudeService;
  promptProcessor: PromptProcessor;
  container: Container;
}

export function getRuntimeServices(): RuntimeServices {
  const container = getContainer();
  return {
    container,
    sessionStore: container.sessionStore,
    workspaceService: container.workspaceService,
    gitService: container.gitService,
    githubAutomationService: container.githubAutomationService,
    claudeClient: container.claudeClient,
    promptProcessor: container.promptProcessor,
  };
}
