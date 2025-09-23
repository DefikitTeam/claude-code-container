/**
 * Refactor Placeholder (Phase 6: Prompt Processor Facade)
 * --------------------------------------------------
 * Orchestrates end-to-end prompt handling:
 *  1. Load session
 *  2. Prepare workspace (git + paths)
 *  3. Ensure auth
 *  4. (Future) Run diagnostics
 *  5. Execute Claude streaming run
 *  6. Persist session updates
 *
 * This facade becomes the primary integration point for handler layer.
 */

import type { ISessionStore } from '../session/session-store';
import type { IWorkspaceService } from '../workspace/workspace-service';
import type { IAuthService } from '../auth/auth-service';
import type { IClaudeClient } from '../claude/claude-client';

// TODO(acp-refactor/phase-6): Add Diagnostics + ErrorClassifier + PromptUtils dependencies.
export interface PromptProcessorDeps {
  sessionStore: ISessionStore;
  workspaceService: IWorkspaceService;
  authService: IAuthService;
  claudeClient: IClaudeClient;
  // diagnosticsService?: IDiagnosticsService; (to be added in phase 4 extraction)
  // errorClassifier?: IErrorClassifier; (centralized errors)
  // promptUtils?: PromptUtilsInterface; (token estimation, formatting)
}

export interface ProcessPromptOptions {
  sessionId: string;
  prompt: string;
  reuseWorkspace?: boolean;
}

export class PromptProcessor {
  constructor(private deps: PromptProcessorDeps) {}

  async processPrompt(
    _opts: ProcessPromptOptions,
  ): Promise<{ output: string; meta: Record<string, any> }> {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    // TODO(acp-refactor/phase-6): Implement orchestration logic.
    throw new Error(
      'PromptProcessor.processPrompt not implemented (refactor phase 6 placeholder)',
    );
  }
}

export default PromptProcessor;
