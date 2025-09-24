// Core / error classifier
import { defaultErrorClassifier } from '../core/errors/error-classifier';

// Session store
import { SessionStore } from './session/session-store';
import type { ISessionStore } from './session/session-store';

// Workspace
import { WorkspaceService } from './workspace/workspace-service';
import type { IWorkspaceService } from './workspace/workspace-service';

// Claude client
import { ClaudeClient } from './claude/claude-client';
import type { IClaudeClient } from './claude/claude-client';

// Prompt processor
import { PromptProcessor } from './prompt/prompt-processor';

// Git
import { GitService } from './git/git-service';

// Diagnostics
import { DiagnosticsService } from '../core/diagnostics/diagnostics-service';

// Utility path helpers (assume process.cwd() as root for container runtime)
import path from 'path';

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
    _workspaceService = new WorkspaceService({ baseDir: path.join(process.cwd(), 'tmp-workspaces') });
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

let _claudeClient: IClaudeClient | undefined;
export function claudeClient(): IClaudeClient {
  if (!_claudeClient) {
    _claudeClient = new ClaudeClient({ model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet' });
  }
  return _claudeClient;
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
    });
  }
  return _promptProcessor;
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
  errorClassifier,
});

export type Services = typeof services;
