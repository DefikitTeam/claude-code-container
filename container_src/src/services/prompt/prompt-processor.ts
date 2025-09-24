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

import type { ISessionStore } from '../session/session-store.js';
import type { IWorkspaceService } from '../workspace/workspace-service.js';
import type { IClaudeClient, ClaudeRunCallbacks } from '../claude/claude-client.js';
import type { GitService } from '../git/git-service.js';
import type { DiagnosticsService } from '../../core/diagnostics/diagnostics-service.js';
import { buildPromptFromContent, estimateTokens } from '../../core/prompts/prompt-utils.js';
import { defaultErrorClassifier } from '../../core/errors/error-classifier.js';
import type { ContentBlock, SessionPromptResponse } from '../../types/acp-messages';
import type { ACPSession } from '../../types/acp-session.js';

// TODO(acp-refactor/phase-6): Add Diagnostics + ErrorClassifier + PromptUtils dependencies.
export interface PromptProcessorDeps {
  sessionStore: ISessionStore;
  workspaceService: IWorkspaceService;
  claudeClient: IClaudeClient;
  gitService?: GitService;
  diagnosticsService?: DiagnosticsService;
}

export interface ProcessPromptOptions {
  sessionId: string;
  content: ContentBlock[];
  contextFiles?: string[];
  agentContext?: Record<string, unknown>;
  apiKey?: string;
  reuseWorkspace?: boolean;
  notificationSender?: (method: string, params: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  abortSignal?: AbortSignal;
  historyAlreadyAppended?: boolean; // if handler already appended, avoid double push
  operationId?: string; // for enhanced cancellation tracking
}

export class PromptProcessor {
  constructor(private deps: PromptProcessorDeps) {}

  async processPrompt(opts: ProcessPromptOptions): Promise<SessionPromptResponse['result']> {
    const {
      sessionId,
      content,
      contextFiles,
      agentContext,
      apiKey,
      reuseWorkspace = true,
      notificationSender,
      abortSignal,
    } = opts;

    if (!sessionId) throw new Error('sessionId required');
    if (!Array.isArray(content) || content.length === 0) throw new Error('content must be non-empty array');

    // 1. Load session (from store or error)
  const session = await this.loadSession(sessionId);

    // 2. Build prompt text from content blocks
    const prompt = buildPromptFromContent(content, contextFiles, agentContext, session);
    const inputEst = estimateTokens(prompt).estimatedTokens;

    // 3. Prepare workspace
    const wsDesc = await this.deps.workspaceService.prepare({
      sessionId,
      reuse: reuseWorkspace,
      workspaceUri: session.workspaceUri,
      sessionOptions: session.sessionOptions,
    });

    // 4.5 Optional diagnostics pre-run
    let preDiagnostics: Record<string, unknown> | undefined;
    if (this.deps.diagnosticsService) {
      try { preDiagnostics = await this.deps.diagnosticsService.run({ workspacePath: session.workspaceUri && new URL(session.workspaceUri).pathname }); } catch (e) { /* ignore */ }
    }

    // 5. Execute Claude streaming run via claudeClient
    const startTime = Date.now();
    let fullText = '';
    let outputTokens = 0;
    let finished = false;
    let completionError: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any

    const callbacks: ClaudeRunCallbacks = {
      onStart: () => {
        notificationSender?.('session/update', {
          sessionId,
          status: 'working',
          message: 'Processing with Claude...',
          progress: { current: 0, total: 3, message: 'Queued' },
        });
      },
      onDelta: (delta) => {
        if (delta.text) fullText += delta.text;
        if (delta.tokens) outputTokens += delta.tokens;
        notificationSender?.('session/update', {
            sessionId,
            status: 'working',
            message: 'Claude streaming...',
            progress: { current: Math.max(1, Math.floor(outputTokens / 50)), total: 3, message: 'Streaming' },
          });
      },
      onComplete: () => {
        finished = true;
        notificationSender?.('session/update', {
          sessionId,
          status: 'completed',
          message: 'Completed',
        });
      },
      onError: (err) => {
        completionError = err;
      },
    };

    try {
      await this.deps.claudeClient.runPrompt(prompt, { sessionId, operationId: opts.operationId, workspacePath: wsDesc.path, apiKey, abortSignal }, callbacks);
    } catch (err) {
      completionError = err;
    }

    const durationMs = Date.now() - startTime;

    if (completionError) {
      const classified = defaultErrorClassifier.classify(completionError);
      // extract stderr / diagnostics from error.detail if present
      const detail = (completionError as any)?.detail || {}; // eslint-disable-line @typescript-eslint/no-explicit-any
      const stderr: string | undefined = typeof detail.stderr === 'string' ? detail.stderr.slice(0, 4000) : undefined;
      const exitCode: number | undefined = typeof detail.exitCode === 'number' ? detail.exitCode : undefined;
      const rawDiagnostics = detail.diagnostics;
      notificationSender?.('session/update', {
        sessionId,
        status: classified.code === 'cancelled' ? 'completed' : 'error',
        message: classified.message,
      });
      return {
        stopReason: classified.code === 'cancelled' ? 'cancelled' : 'error',
        usage: { inputTokens: inputEst, outputTokens },
        summary: `(${classified.code}) ${classified.message}`,
        errorCode: classified.code,
        diagnostics: {
          durationMs,
          classification: classified,
          stderr,
          exitCode,
          preDiagnostics,
          runtimeDiagnostics: rawDiagnostics,
        },
      } as any; // keep compatibility with existing handler
    }

    // 6. Persist session updates (append message history if not already appended by caller)
    session.lastActiveAt = Date.now();
    if (!opts.historyAlreadyAppended) {
      session.messageHistory.push(content);
    }
    if (session.sessionOptions?.persistHistory) {
      try { await this.deps.sessionStore.save(session); } catch (e) { console.warn('[PromptProcessor] session persistence failed:', (e as Error).message); }
    }

    // 7. Detect potential git operations (enhanced if gitService provided)
    let githubOperations: SessionPromptResponse['result']['githubOperations'] | undefined = undefined;
    if (this.deps.gitService) {
      try {
  const modified = await this.deps.gitService.listChangedFiles?.(wsDesc.path);
        const branch = wsDesc.gitInfo?.currentBranch;
        if (branch || (modified && modified.length)) {
          githubOperations = {
            branchCreated: undefined,
            filesModified: modified && modified.length ? modified.slice(0, 50) : undefined,
          } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        }
      } catch { /* ignore git detection errors */ }
    } else {
      // fallback lightweight
      if (wsDesc.gitInfo?.currentBranch) {
        githubOperations = wsDesc.gitInfo.hasUncommittedChanges ? { filesModified: ['(uncommitted changes present)'] } as any : undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
      }
    }

    const response: SessionPromptResponse['result'] = {
      stopReason: 'completed',
      usage: { inputTokens: inputEst, outputTokens },
      summary: fullText.substring(0, 200) + (fullText.length > 200 ? '...' : ''),
    };
    if (githubOperations) response.githubOperations = githubOperations;
    // attach minimal meta (duration) – existing shape allows additional fields
    (response as any).meta = {
      durationMs,
      preDiagnostics,
      workspace: {
        sessionId: wsDesc.sessionId,
        path: wsDesc.path,
        isEphemeral: wsDesc.isEphemeral,
        git: wsDesc.gitInfo || undefined,
        createdAt: wsDesc.createdAt,
      },
    }; // eslint-disable-line @typescript-eslint/no-explicit-any
    return response;
  }

  private async loadSession(sessionId: string): Promise<ACPSession> {
    const s = await this.deps.sessionStore.load(sessionId);
    if (!s) throw new Error(`session not found: ${sessionId}`);
    return s;
  }
}

export default PromptProcessor;
