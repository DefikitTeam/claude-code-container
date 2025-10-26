// Core / error classifier
import { defaultErrorClassifier } from '../core/errors/error-classifier.js';

// Session store
import { SessionStore } from './session/session-store.js';
import type { ISessionStore } from './session/session-store.js';

// Workspace
import { WorkspaceService } from './workspace/workspace-service.js';
import type { IWorkspaceService } from './workspace/workspace-service.js';

// Claude client
// import { ClaudeClient } from './claude/claude-client.js';
import type { IClaudeService } from '../core/interfaces/services/claude.service.js';

// Prompt processor
import { PromptProcessor } from './prompt/prompt-processor.js';

// Git
import { GitService } from './git/git-service.js';

// GitHub automation
import { GitHubAutomationService } from './github/github-automation.js';

// Diagnostics
import { DiagnosticsService } from '../core/diagnostics/diagnostics-service.js';

// Utility path helpers (assume process.cwd() as root for container runtime)
import path from 'path';
import ClaudeClient from './claude/claude-client.js';

// ---- Lazy instantiation helpers -------------------------------------------------

let _sessionStore: ISessionStore | undefined;
export function sessionStore(): ISessionStore {
  if (!_sessionStore) {
    const sessionsDir = path.join(process.cwd(), '.acp-sessions');
    _sessionStore = new SessionStore({ basePath: sessionsDir });
  }
  return _sessionStore;
}

let _workspaceService: IWorkspaceService | undefined;
export function workspaceService(): IWorkspaceService {
  if (!_workspaceService) {
    _workspaceService = new WorkspaceService({
      baseDir: path.join(process.cwd(), 'tmp-workspaces'),
    });
  }
  return _workspaceService;
}

let _gitService: GitService | undefined;
export function gitService(): GitService {
  if (!_gitService) {
    _gitService = new GitService();
  }
  return _gitService;
}

let _diagnosticsService: DiagnosticsService | undefined;
export function diagnosticsService(): DiagnosticsService {
  if (!_diagnosticsService) {
    _diagnosticsService = new DiagnosticsService();
  }
  return _diagnosticsService;
}

let _claudeClient: IClaudeService | undefined;
export function claudeClient(): IClaudeService {
  if (!_claudeClient) {
    _claudeClient = new ClaudeClient({
      defaultModel: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet',
    });
  }
  return _claudeClient!;
}

let _promptProcessor: PromptProcessor | undefined;
export function promptProcessor(): PromptProcessor {
  if (!_promptProcessor) {
    _promptProcessor = new PromptProcessor({
      sessionStore: sessionStore(),
      workspaceService: workspaceService(),
      claudeClient: claudeClient(),
      gitService: gitService(),
      diagnosticsService: diagnosticsService(),
      githubAutomationService: githubAutomationService(),
    });
  }
  return _promptProcessor;
}

let _githubAutomationService: GitHubAutomationService | undefined;
export function githubAutomationService(): GitHubAutomationService {
  if (!_githubAutomationService) {
    _githubAutomationService = new GitHubAutomationService({
      gitService: gitService(),
    });
  }
  return _githubAutomationService;
}

// Re-export classifier for convenience
export const errorClassifier = defaultErrorClassifier;

// Aggregated convenience object (read-only pattern)
export const services = Object.freeze({
  sessionStore: sessionStore(),
  workspaceService: workspaceService(),
  claudeClient: claudeClient(),
  promptProcessor: promptProcessor(),
  gitService: gitService(),
  diagnosticsService: diagnosticsService(),
  githubAutomationService: githubAutomationService(),
  errorClassifier,
});

export type Services = typeof services;
