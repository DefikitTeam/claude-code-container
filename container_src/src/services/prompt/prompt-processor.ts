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
import type {
  IWorkspaceService,
  WorkspaceDescriptor,
} from '../workspace/workspace-service.js';
import type {
  IClaudeService,
  ClaudeCallbacks,
  ClaudeResult,
} from '../../core/interfaces/services/claude.service.js';
import type { GitService } from '../git/git-service.js';
import type { DiagnosticsService } from '../../core/diagnostics/diagnostics-service.js';
import type {
  IGitHubAutomationService,
  GitHubAutomationContext,
  GitHubAutomationResult,
  AutomationIntentSignals,
  GitHubIssueReference,
} from '../../core/interfaces/services/github-automation.service.js';
import {
  buildPromptFromContent,
  estimateTokens,
} from '../../core/prompts/prompt-utils.js';
import { defaultErrorClassifier } from '../../core/errors/error-classifier.js';
import type {
  ContentBlock,
  SessionPromptResponse,
} from '../../types/acp-messages';
import type { ACPSession } from '../../types/acp-session.js';
import { useDomainEntities } from '../../core/config/feature-flags.js';
import { SessionEntity } from '../../core/entities/session.entity.js';
import { PromptEntity } from '../../core/entities/prompt.entity.js';
import { WorkspaceEntity } from '../../core/entities/workspace.entity.js';
import { extractPatchesFromText, extractFileWriteCandidate } from './patch-applier.js';

const GITHUB_AUTOMATION_VERSION = '1.0.0';

// TODO(acp-refactor/phase-6): Add Diagnostics + ErrorClassifier + PromptUtils dependencies.
export interface PromptProcessorDeps {
  sessionStore: ISessionStore;
  workspaceService: IWorkspaceService;
  claudeClient: IClaudeService;
  gitService?: GitService;
  diagnosticsService?: DiagnosticsService;
  githubAutomationService?: IGitHubAutomationService;
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
  sessionMeta?: {
    userId?: string;
    installationId?: string;
  };
  githubToken?: string;
  rawParams?: Record<string, unknown>;
}

export class PromptProcessor {
  constructor(private deps: PromptProcessorDeps) {}

  async processPrompt(
    opts: ProcessPromptOptions,
  ): Promise<SessionPromptResponse['result']> {
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

    const operationId = opts.operationId ?? `prompt-${Date.now()}`;
    const logFullContent = process.env.ACP_LOG_FULL_CONTENT === '1';
    const logPrefix = `[PROMPT][${sessionId}${operationId ? `:${operationId}` : ''}]`;
    const logFull = (
      ...parts: Array<string | number | boolean | undefined>
    ) => {
      if (!logFullContent) return;
      const message = parts
        .filter((p) => p !== undefined)
        .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
        .join(' ');
      console.error(`${logPrefix} ${message}`);
    };

    if (!sessionId) throw new Error('sessionId required');
    if (!Array.isArray(content) || content.length === 0)
      throw new Error('content must be non-empty array');

    // 1. Load session (from store or error)
    const baseSession = await this.loadSession(sessionId);
    const entitiesEnabled = useDomainEntities();
    let sessionEntity = entitiesEnabled
      ? SessionEntity.fromPlain(baseSession)
      : undefined;
    let session: ACPSession = sessionEntity
      ? sessionEntity.toJSON()
      : baseSession;

    const mergedAgentContext = this.mergeAgentContext(
      session.agentContext,
      agentContext,
    );
    if (sessionEntity) {
      sessionEntity = sessionEntity.withAgentContext(mergedAgentContext);
      session = sessionEntity.toJSON();
    } else if (mergedAgentContext) {
      session.agentContext = mergedAgentContext;
    }

    const activeAgentContext =
      sessionEntity?.agentContext ?? session.agentContext ?? agentContext;

    // 2. Build prompt text from content blocks
    let promptEntity: PromptEntity | undefined;
    let prompt: string;
    let inputEst: number;

    if (entitiesEnabled) {
      promptEntity = PromptEntity.create(
        { content, contextFiles, agentContext: activeAgentContext },
        session,
      );
      prompt = promptEntity.text;
      inputEst = promptEntity.tokenEstimate;
    } else {
      prompt = buildPromptFromContent(
        content,
        contextFiles,
        activeAgentContext,
        session,
      );
      inputEst = estimateTokens(prompt).estimatedTokens;
    }
    logFull('prompt', prompt);

    // 3. Prepare workspace
    let wsDesc = await this.deps.workspaceService.prepare({
      sessionId,
      reuse: reuseWorkspace,
      workspaceUri: session.workspaceUri,
      sessionOptions: session.sessionOptions,
    });

    // IMPORTANT: ensure repository is cloned into the workspace BEFORE running the model.
    // The older/main flow cloned the repository prior to the Claude run so that any
    // file writes or applied patches happen inside a real git checkout. If we don't
    // clone first, the automation later may re-clone or init the repo and the
    // model's modifications get lost / are not detected ("No workspace changes detected").
    let repoEnsured = false;
    // Resolve repository descriptor (may be used for cloning and also passed
    // to the OpenHands adapter so the remote agent has repository context).
    let resolvedRepo = undefined as
      | {
          owner: string;
          name: string;
          defaultBranch?: string;
          cloneUrl?: string;
          issueTitle?: string;
          labels?: string[];
          issue?: any;
          branchNameOverride?: string;
          baseBranchOverride?: string;
          gitIdentity?: { name?: string; email?: string };
          dryRun?: boolean;
          allowEmptyCommit?: boolean;
          source?: string;
        }
      | undefined;

    try {
      resolvedRepo = this.resolveRepositoryDescriptor(
        activeAgentContext,
        opts,
        wsDesc,
      );
      console.error(`[PROMPT][${sessionId}] resolvedRepo:`, JSON.stringify({
        owner: resolvedRepo?.owner,
        name: resolvedRepo?.name,
        cloneUrl: resolvedRepo?.cloneUrl ? 'present' : 'missing',
        defaultBranch: resolvedRepo?.defaultBranch,
      }));
      const token = await this.resolveGitHubToken(activeAgentContext, opts);
      console.error(`[PROMPT][${sessionId}] token:`, token ? 'present' : 'missing', 'gitService:', !!this.deps.gitService);

      // CRITICAL FIX: If cloneUrl is missing but we have owner/name, construct it
      // DO NOT embed token here - let buildAuthedUrl handle it in automation service
      if (resolvedRepo && !resolvedRepo.cloneUrl && resolvedRepo.owner && resolvedRepo.name) {
        const baseUrl = `https://github.com/${resolvedRepo.owner}/${resolvedRepo.name}.git`;
        resolvedRepo.cloneUrl = baseUrl; // Plain URL without token
        console.error(`[PROMPT][${sessionId}] auto-constructed cloneUrl from owner/name:`, baseUrl);
      }

      if (resolvedRepo && resolvedRepo.cloneUrl && this.deps.gitService) {
        // Attempt to ensure the repo is present in the workspace path (shallow clone/init)
        // Add authentication for clone operation
        const authedCloneUrl = token && resolvedRepo.cloneUrl
          ? resolvedRepo.cloneUrl.replace('https://github.com/', `https://x-access-token:${token}@github.com/`)
          : resolvedRepo.cloneUrl;
        console.error(`[PROMPT][${sessionId}] calling ensureRepo at path:`, wsDesc.path);
        try {
          await this.deps.gitService.ensureRepo(wsDesc.path, {
            defaultBranch: resolvedRepo.defaultBranch,
            cloneUrl: authedCloneUrl,
          });
          console.error(`[PROMPT][${sessionId}] ensureRepo completed successfully`);
          // Try to fetch the base branch so workspace is up-to-date
          if (resolvedRepo.defaultBranch) {
            await this.deps.gitService.runGit(wsDesc.path, [
              'fetch',
              'origin',
              resolvedRepo.defaultBranch,
            ]);
            await this.deps.gitService.checkoutBranch(
              wsDesc.path,
              resolvedRepo.defaultBranch,
            );
          }
          repoEnsured = true;
          console.error(`[PROMPT][${sessionId}] ensured repo present at workspace`);
        } catch (e) {
          console.error(`[PROMPT][${sessionId}] pre-clone failed:`,
            e instanceof Error ? e.message : String(e),
            e instanceof Error ? e.stack : '');
        }
      } else {
        console.error(`[PROMPT][${sessionId}] skipping ensureRepo - condition not met`);
      }
    } catch (e) {
      // non-fatal: proceed without pre-clone (automation will still attempt),
      // but log for diagnostics
      console.error(`[PROMPT][${sessionId}] resolveRepo (pre-clone) failed:`,
        e instanceof Error ? e.message : String(e),
        e instanceof Error ? e.stack : '');
    }

    if (!repoEnsured) {
      console.error(`[PROMPT][${sessionId}] WARNING: Repository was not cloned before Claude run. File writes may not be detected by git!`);
    }

    if (entitiesEnabled) {
      wsDesc = WorkspaceEntity.fromDescriptor(wsDesc).toJSON();
    }

    // 4.5 Optional diagnostics pre-run
    let preDiagnostics: Record<string, unknown> | undefined;
    if (this.deps.diagnosticsService) {
      try {
        // IMPORTANT: Use wsDesc.path (where we cloned the repo), NOT session.workspaceUri
        // session.workspaceUri might be a file:// URI or different path
        preDiagnostics = await this.deps.diagnosticsService.run({
          workspacePath: wsDesc.path,
        });
      } catch (e) {
        /* ignore */
      }
    }

    // 5. Execute Claude streaming run via claudeClient
    const startTime = Date.now();
    let fullText = '';
    let outputTokens = 0;
  let completionError: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  let runResult: ClaudeResult | undefined;

    const callbacks: ClaudeCallbacks = {
      onStart: () => {
        notificationSender?.('session/update', {
          sessionId,
          status: 'working',
          message: 'Processing with Claude...',
          progress: { current: 0, total: 3, message: 'Queued' },
        });
        logFull('run_start', `estimatedInputTokens=${inputEst}`);
      },
      onDelta: (delta) => {
        if (delta.text) fullText += delta.text;
        if (delta.tokens) outputTokens += delta.tokens;
        if (delta.text) logFull('delta', delta.text);
        notificationSender?.('session/update', {
          sessionId,
          status: 'working',
          message: 'Claude streaming...',
          progress: {
            current: Math.max(1, Math.floor(outputTokens / 50)),
            total: 3,
            message: 'Streaming',
          },
        });
      },
      onComplete: () => {
        logFull(
          'run_complete',
          `outputTokens=${outputTokens}`,
          'full_text',
          fullText,
        );
        notificationSender?.('session/update', {
          sessionId,
          status: 'completed',
          message: 'Completed',
        });
      },
      onError: (err) => {
        logFull('run_error', err instanceof Error ? err.message : String(err));
        completionError = err;
      },
    };

    try {
      // runtimeOptions typed as any to avoid requiring changes to RunOptions
      const runtimeOptions: any = {
        sessionId,
        operationId,
        workspacePath: wsDesc.path,
        apiKey,
        abortSignal,
      };
      if (resolvedRepo && resolvedRepo.owner && resolvedRepo.name) {
        runtimeOptions.repository = `${resolvedRepo.owner}/${resolvedRepo.name}`;
      }

      runResult = await this.deps.claudeClient.runPrompt(
        prompt,
        runtimeOptions,
        callbacks,
      );
    } catch (err) {
      completionError = err;
    }

    const durationMs = Date.now() - startTime;

    if (completionError) {
      const classified = defaultErrorClassifier.classify(completionError);
      // extract stderr / diagnostics from error.detail if present
      const detail = (completionError as any)?.detail || {}; // eslint-disable-line @typescript-eslint/no-explicit-any
      const stderr: string | undefined =
        typeof detail.stderr === 'string'
          ? detail.stderr.slice(0, 4000)
          : undefined;
      const exitCode: number | undefined =
        typeof detail.exitCode === 'number' ? detail.exitCode : undefined;
      const rawDiagnostics = detail.diagnostics;
      logFull(
        'run_failed',
        classified.code,
        classified.message,
        stderr,
        rawDiagnostics ? JSON.stringify(rawDiagnostics) : undefined,
      );
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
    const lastActiveTimestamp = Date.now();
    if (sessionEntity) {
      sessionEntity = sessionEntity.touchLastActiveAt(lastActiveTimestamp);
      if (!opts.historyAlreadyAppended) {
        const historyContent = promptEntity
          ? Array.from<ContentBlock>(promptEntity.content)
          : content;
        sessionEntity = sessionEntity.appendMessageHistory(
          historyContent,
          lastActiveTimestamp,
        );
      }
      session = sessionEntity.toJSON();
    } else {
      session.lastActiveAt = lastActiveTimestamp;
      if (!opts.historyAlreadyAppended) {
        session.messageHistory.push(content);
      }
    }

    const shouldPersist = sessionEntity
      ? sessionEntity.shouldPersistHistory()
      : session.sessionOptions?.persistHistory;

    if (shouldPersist) {
      try {
        await this.deps.sessionStore.save(session);
      } catch (e) {
        console.warn(
          '[PromptProcessor] session persistence failed:',
          (e as Error).message,
        );
      }
    }

    // 7. Detect potential git operations (enhanced if gitService provided)
    let githubOperations:
      | SessionPromptResponse['result']['githubOperations']
      | undefined = undefined;
    if (this.deps.gitService) {
      try {
        const modified = await this.deps.gitService.listChangedFiles?.(
          wsDesc.path,
        );
        const branch = wsDesc.gitInfo?.currentBranch;
        if (branch || (modified && modified.length)) {
          githubOperations = {
            branchCreated: undefined,
            filesModified:
              modified && modified.length ? modified.slice(0, 50) : undefined,
          } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        }
      } catch {
        /* ignore git detection errors */
      }
    } else {
      // fallback lightweight
      if (wsDesc.gitInfo?.currentBranch) {
        githubOperations = wsDesc.gitInfo.hasUncommittedChanges
          ? ({ filesModified: ['(uncommitted changes present)'] } as any)
          : undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
      }
    }

    if (!fullText && runResult?.fullText) {
      fullText = runResult.fullText;
    }

    const inputTokensUsed = runResult?.tokens?.input ?? inputEst;
    const outputTokensUsed = runResult?.tokens?.output ?? outputTokens;

    const response: SessionPromptResponse['result'] = {
      stopReason: 'completed',
      usage: { inputTokens: inputTokensUsed, outputTokens: outputTokensUsed },
      summary:
        fullText.substring(0, 200) + (fullText.length > 200 ? '...' : ''),
    };
    console.error(
      `[PROMPT-SUMMARY][${sessionId}${operationId ? `:${operationId}` : ''}] ${response.summary ?? ''}`,
    );
    if (githubOperations) response.githubOperations = githubOperations;
    // attach minimal meta (duration) – existing shape allows additional fields
    const meta: Record<string, unknown> = {
      durationMs,
      preDiagnostics,
      workspace: {
        sessionId: wsDesc.sessionId,
        path: wsDesc.path,
        isEphemeral: wsDesc.isEphemeral,
        git: wsDesc.gitInfo || undefined,
        createdAt: wsDesc.createdAt,
      },
    };

    // Attempt to auto-apply unified-diff patches produced by the model, if enabled.
    // Controlled via env APPLY_MODEL_PATCHES (default: enabled). Uses gitService.applyPatch.
    if (process.env.APPLY_MODEL_PATCHES !== '0' && this.deps.gitService && fullText) {
      try {
        const patches = extractPatchesFromText(fullText);
        if (patches && patches.length) {
          for (let i = 0; i < patches.length; i++) {
            const patch = patches[i];
            try {
              console.error(
                `[PATCH-APPLY][${sessionId}] applying patch #${i + 1} size=${Buffer.byteLength(
                  patch,
                  'utf8',
                )} bytes`,
              );
              // applyPatch may throw; we capture and continue
              // @ts-ignore - gitService is optional but checked above
              await this.deps.gitService.applyPatch(wsDesc.path, patch);
              console.error(`[PATCH-APPLY][${sessionId}] patch #${i + 1} applied`);
            } catch (err) {
              console.error(
                `[PATCH-APPLY][${sessionId}] failed to apply patch #${i + 1}`,
                err instanceof Error ? err.message : String(err),
              );
              // record patch apply error in meta for diagnostics / issue body
              const arr = (meta as any).patchApplyErrors || [];
              arr.push({ index: i + 1, error: err instanceof Error ? err.message : String(err) });
              (meta as any).patchApplyErrors = arr;
            }
          }
        }
      } catch (e) {
        console.error(`[PATCH-APPLY][${sessionId}] extractor error`, e instanceof Error ? e.message : String(e));
      }
    }

    // ⚠️ NO-FALLBACK PRINCIPLE: File writes should ONLY happen via AI tool usage
    // This fallback logic has been REMOVED to prevent wrong results.
    //
    // If no files were changed, that means:
    // 1. AI responded conversationally instead of using tools (ERROR)
    // 2. AI didn't understand the request (ERROR)
    // 3. Request was not a file operation (OK)
    //
    // DO NOT try to "help" by extracting code from text - this creates garbage results.
    // Better to fail clearly than succeed incorrectly.
    //
    // To re-enable legacy fallback behavior (NOT RECOMMENDED):
    // Set environment variable: ENABLE_FALLBACK_FILE_WRITE=1

    if (process.env.ENABLE_FALLBACK_FILE_WRITE === '1') {
      console.warn(`[FILE-WRITE][${sessionId}] WARNING: Legacy fallback file write is enabled. This can produce incorrect results.`);

      try {
        let preChanged: string[] = [];
        if (this.deps.gitService && typeof this.deps.gitService.listChangedFiles === 'function') {
          // @ts-ignore - guarded above
          preChanged = (await this.deps.gitService.listChangedFiles(wsDesc.path)) || [];
        }

        if (preChanged.length === 0 && fullText) {
          const candidate = extractFileWriteCandidate(prompt, fullText);
          if (!candidate) {
            console.error(`[FILE-WRITE][${sessionId}] No file write candidate found. AI may have responded conversationally without using tools or providing code blocks.`);
          } else {
            console.warn(`[FILE-WRITE][${sessionId}] Attempting fallback file write for ${candidate.filename} - this may produce incorrect results!`);
            // Fallback logic would go here, but we're not implementing it
            // to prevent wrong results from being committed
          }
        }
      } catch (e) {
        console.error(`[FILE-WRITE][${sessionId}] fallback detection error`, e instanceof Error ? e.message : String(e));
      }
    }

    const automationResult = await this.executeGitHubAutomation({
      session,
      workspace: wsDesc,
      promptText: prompt,
      summaryText: fullText,
      agentContext: activeAgentContext,
      options: opts,
      operationId,
    });

    // Comprehensive diagnostic: capture detailed git state right before automation executes
    try {
      if (this.deps.gitService) {
        // Import diagnostic utility
        const { diagnoseWorkspace, formatDiagnosticResult } = await import('./workspace-diagnostic.js');

        // Run comprehensive diagnostic
        const diagnostic = await diagnoseWorkspace(wsDesc.path, [
          'styles.css',
          (meta as any).autoWrittenFile,
        ].filter(Boolean));

        // Store in meta for API response
        (meta as any).workspaceDiagnostic = diagnostic;

        // Log formatted report
        console.error(`[WORKSPACE-DIAGNOSTIC][${session.sessionId}]\n${formatDiagnosticResult(diagnostic)}`);

        // Also keep lightweight version for backwards compatibility
        const gitStatus = await this.deps.gitService.getStatus(wsDesc.path).catch((e) => `error: ${String(e)}`);
        const changedFiles = await this.deps.gitService.listChangedFiles(wsDesc.path).catch((e) => [`error: ${String(e)}`]);
        const hasUncommitted = await this.deps.gitService.hasUncommittedChanges(wsDesc.path).catch(() => {
          return false;
        });
        (meta as any).githubPreAuto = {
          gitStatus: typeof gitStatus === 'string' ? gitStatus : String(gitStatus),
          changedFiles: Array.isArray(changedFiles) ? changedFiles : [String(changedFiles)],
          hasUncommittedChanges: hasUncommitted,
        };
        console.error(`[GIT-DIAG][${session.sessionId}] status=${(meta as any).githubPreAuto.gitStatus} hasUncommitted=${hasUncommitted} files=${JSON.stringify((meta as any).githubPreAuto.changedFiles)}`);
      }
    } catch (e) {
      console.error(`[GIT-DIAG][${session.sessionId}] diagnostic failed`, e instanceof Error ? e.message : String(e));
    }

    if (automationResult) {
      response.githubAutomation = automationResult;
      meta.githubAutomationVersion = GITHUB_AUTOMATION_VERSION;
      if (automationResult.status === 'success') {
        response.githubOperations = this.mergeLegacyGithubOperations(
          response.githubOperations,
          automationResult,
        );
      }
    }

    (response as any).meta = meta; // eslint-disable-line @typescript-eslint/no-explicit-any
    return response;
  }

  private async loadSession(sessionId: string): Promise<ACPSession> {
    const s = await this.deps.sessionStore.load(sessionId);
    if (!s) throw new Error(`session not found: ${sessionId}`);
    return s;
  }

  private mergeAgentContext(
    existing: Record<string, unknown> | undefined,
    incoming: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    if (!existing && !incoming) return undefined;
    if (!existing) return incoming ? { ...incoming } : undefined;
    if (!incoming) return existing;

    const result: Record<string, unknown> = { ...existing, ...incoming };
    const existingAutomation = this.asRecord(existing.automation);
    const incomingAutomation = this.asRecord(incoming.automation);
    if (existingAutomation || incomingAutomation) {
      result.automation = { ...existingAutomation, ...incomingAutomation };
    }
    return result;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private async executeGitHubAutomation(args: {
    session: ACPSession;
    workspace: WorkspaceDescriptor;
    promptText: string;
    summaryText: string;
    agentContext?: Record<string, unknown>;
    options: ProcessPromptOptions;
    operationId?: string;
  }): Promise<GitHubAutomationResult | undefined> {
    const service = this.deps.githubAutomationService;
    if (!service) return undefined;
    if (process.env.GITHUB_AUTOMATION_DISABLED === '1') {
      return this.buildAutomationSkipped('Automation disabled via env flag');
    }

    const {
      session,
      workspace,
      promptText,
      summaryText,
      agentContext,
      options,
      operationId,
    } = args;

    if (session.sessionOptions?.enableGitOps === false) {
      return this.buildAutomationSkipped('GitOps disabled for session');
    }

    const token = await this.resolveGitHubToken(agentContext, options);
    if (!token) {
      return this.buildAutomationSkipped('Missing GitHub token');
    }

    const resolvedRepo = this.resolveRepositoryDescriptor(
      agentContext,
      options,
      workspace,
    );
    if (!resolvedRepo) {
      return this.buildAutomationSkipped('Missing repository metadata');
    }

    // Auto-construct cloneUrl if missing (DO NOT embed token - buildAuthedUrl handles it)
    if (!resolvedRepo.cloneUrl && resolvedRepo.owner && resolvedRepo.name) {
      resolvedRepo.cloneUrl = `https://github.com/${resolvedRepo.owner}/${resolvedRepo.name}.git`;
    }

    const intent = this.resolveAutomationIntent(agentContext, options);
    const metadata = this.buildAutomationMetadata(
      session,
      options,
      resolvedRepo.source,
      operationId,
    );

    const context: GitHubAutomationContext = {
      sessionId: session.sessionId,
      workspacePath: workspace.path,
      repository: {
        owner: resolvedRepo.owner,
        name: resolvedRepo.name,
        defaultBranch: resolvedRepo.defaultBranch,
        cloneUrl: resolvedRepo.cloneUrl,
      },
      auth: { installationToken: token },
      prompt: {
        title: resolvedRepo.issueTitle,
        body: promptText,
      },
      summaryMarkdown: summaryText.trim().slice(0, 4000) || undefined,
      intent,
      existingIssue: resolvedRepo.issue,
      labels: resolvedRepo.labels,
      branchNameOverride: resolvedRepo.branchNameOverride,
      baseBranchOverride: resolvedRepo.baseBranchOverride,
      git: resolvedRepo.gitIdentity,
      metadata,
      dryRun: resolvedRepo.dryRun,
      allowEmptyCommit: resolvedRepo.allowEmptyCommit,
      workspaceAlreadyPrepared: true,
    };

    this.logAutomation('start', session.sessionId, operationId, {
      repository: `${context.repository.owner}/${context.repository.name}`,
      defaultBranch: context.repository.defaultBranch,
      dryRun: context.dryRun,
    });

    try {
      const result = await service.execute(context);
      this.logAutomation(result.status, session.sessionId, operationId, {
        branch: result.branch,
        issue: result.issue?.number,
        pullRequest: result.pullRequest?.number,
        skippedReason: result.skippedReason,
        error: result.error,
      });
      return result;
    } catch (error) {
      this.logAutomation('error', session.sessionId, operationId, {
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        status: 'error',
        error: {
          code: 'automation-execution-failed',
          message:
            error instanceof Error
              ? error.message
              : 'Unknown automation failure',
        },
        diagnostics: this.buildDiagnosticsSnapshot('error', error),
      } as GitHubAutomationResult;
    }
  }

  /**
   * Resolve GitHub token from context
   * 
   * IMPORTANT: Containers NO LONGER generate tokens.
   * Tokens must be provided by the caller (worker) who gets them from LumiLink API.
   * 
   * Priority:
   * 1. Explicit token in options
   * 2. Token in context
   * 3. Environment variable GITHUB_TOKEN (set by worker)
   * 
   * @returns GitHub token or undefined
   */
  private async resolveGitHubToken(
    agentContext: Record<string, unknown> | undefined,
    options: ProcessPromptOptions,
  ): Promise<string | undefined> {
    // 1. Check if token explicitly provided in options
    const fromOptions = options.githubToken;
    if (fromOptions && typeof fromOptions === 'string') return fromOptions;

    // 2. Check for token in context
    const ctxToken = this.findString([
      this.getNested(agentContext, ['githubToken']),
      this.getNested(agentContext, ['token']),
      this.getNested(agentContext, ['github', 'token']),
      this.getNested(options.rawParams, ['githubToken']),
      this.getNested(options.rawParams, ['context', 'githubToken']),
      this.getNested(options.rawParams, ['context', 'github', 'token']),
    ]);
    if (ctxToken) return ctxToken;

    // 3. Fallback to environment variable (provided by worker)
    const envToken = process.env.GITHUB_TOKEN;
    if (envToken) return envToken;

    // 4. Check if installation ID provided without token - log warning
    const installationId = this.findString([
      this.getNested(agentContext, ['installationId']),
      this.getNested(agentContext, ['github', 'installationId']),
      this.getNested(options.rawParams, ['installationId']),
      this.getNested(options.sessionMeta, ['installationId']),
    ]);

    if (installationId) {
      console.warn(
        '[PROMPT] ⚠️ Installation ID provided but no GitHub token found.\n' +
        '[PROMPT] Containers cannot generate tokens. Token must be provided by worker.\n' +
        '[PROMPT] The worker should call LumiLink API to get a token and pass it via:\n' +
        '[PROMPT]   - options.githubToken, or\n' +
        '[PROMPT]   - context.github.token, or\n' +
        '[PROMPT]   - GITHUB_TOKEN environment variable'
      );
    }

    return undefined;
  }

  private resolveRepositoryDescriptor(
    agentContext: Record<string, unknown> | undefined,
    options: ProcessPromptOptions,
    workspace: WorkspaceDescriptor,
  ):
    | {
        owner: string;
        name: string;
        defaultBranch: string;
        cloneUrl?: string;
        issueTitle?: string;
        labels?: string[];
        issue?: GitHubIssueReference;
        branchNameOverride?: string;
        baseBranchOverride?: string;
        gitIdentity?: { name?: string; email?: string };
        dryRun?: boolean;
        allowEmptyCommit?: boolean;
        source?: string;
      }
    | undefined {
    const repoCandidate = this.findRepositoryCandidate(
      agentContext,
      options,
      workspace,
    );
    if (!repoCandidate) return undefined;

    const defaultBranch =
      repoCandidate.defaultBranch ||
      this.findString([
        this.getNested(agentContext, ['branch']),
        this.getNested(agentContext, ['automation', 'baseBranch']),
        this.getNested(agentContext, ['automation', 'defaultBranch']),
        this.getNested(options.rawParams, ['branch']),
        this.getNested(options.rawParams, ['context', 'branch']),
        workspace.gitInfo?.currentBranch,
      ]) ||
      'main';

    const cloneUrl =
      repoCandidate.cloneUrl ||
      this.findString([
        this.getNested(agentContext, ['cloneUrl']),
        this.getNested(agentContext, ['automation', 'cloneUrl']),
        this.getNested(agentContext, ['github', 'cloneUrl']),
        this.getNested(options.rawParams, ['cloneUrl']),
        this.getNested(options.rawParams, ['context', 'cloneUrl']),
        workspace.gitInfo?.remoteUrl,
      ]);

    const labels = this.ensureStringArray(
      this.getNested(agentContext, ['automation', 'labels']) ??
        this.getNested(options.rawParams, [
          'context',
          'automation',
          'labels',
        ]) ??
        this.getNested(options.rawParams, ['labels']),
    );

    const issueTitle = this.findString([
      this.getNested(agentContext, ['automation', 'issueTitle']),
      this.getNested(options.rawParams, [
        'context',
        'automation',
        'issueTitle',
      ]),
      this.getNested(options.rawParams, ['issueTitle']),
    ]);

    const branchNameOverride = this.findString([
      this.getNested(agentContext, ['automation', 'branchName']),
      this.getNested(options.rawParams, [
        'context',
        'automation',
        'branchName',
      ]),
    ]);

    const baseBranchOverride = this.findString([
      this.getNested(agentContext, ['automation', 'baseBranch']),
      this.getNested(options.rawParams, [
        'context',
        'automation',
        'baseBranch',
      ]),
      this.getNested(options.rawParams, ['baseBranch']),
    ]);

    const issueRef = this.normalizeIssueReference(
      this.getNested(agentContext, ['automation', 'issue']) ??
        this.getNested(options.rawParams, ['context', 'automation', 'issue']) ??
        this.getNested(options.rawParams, ['issue']),
    );

    const gitIdentity = this.normalizeGitIdentity(
      this.getNested(agentContext, ['automation', 'git']) ??
        this.getNested(options.rawParams, ['context', 'automation', 'git']),
    );

    const dryRun = this.toBoolean(
      this.getNested(agentContext, ['automation', 'dryRun']) ??
        this.getNested(options.rawParams, [
          'context',
          'automation',
          'dryRun',
        ]) ??
        this.getNested(options.rawParams, ['dryRun']),
    );

    const allowEmptyCommit = this.toBoolean(
      this.getNested(agentContext, ['automation', 'allowEmptyCommit']) ??
        this.getNested(options.rawParams, [
          'context',
          'automation',
          'allowEmptyCommit',
        ]),
    );

    return {
      owner: repoCandidate.owner,
      name: repoCandidate.name,
      defaultBranch,
      cloneUrl,
      issueTitle,
      labels,
      issue: issueRef,
      branchNameOverride,
      baseBranchOverride,
      gitIdentity,
      dryRun,
      allowEmptyCommit,
      source: repoCandidate.source,
    };
  }

  private resolveAutomationIntent(
    agentContext: Record<string, unknown> | undefined,
    options: ProcessPromptOptions,
  ): AutomationIntentSignals | undefined {
    const automationNode =
      this.asRecord(this.getNested(agentContext, ['automation'])) ??
      this.asRecord(
        this.getNested(options.rawParams, ['context', 'automation']),
      );
    if (!automationNode) {
      return agentContext ? { agentContext } : undefined;
    }

    const intent: AutomationIntentSignals = {
      mode: this.findString([
        automationNode.mode,
        this.getNested(agentContext, ['automationMode']),
        this.getNested(options.rawParams, ['automationMode']),
      ])?.toLowerCase(),
      disabled: this.toBoolean(automationNode.disabled),
      repositoryBlocked: this.toBoolean(automationNode.repositoryBlocked),
      reason: this.findString([automationNode.reason]),
      explicit: this.toBoolean(automationNode.explicit),
      force: this.toBoolean(automationNode.force),
      agentContext,
    };
    return intent;
  }

  private buildAutomationMetadata(
    session: ACPSession,
    options: ProcessPromptOptions,
    repositorySource?: string,
    operationId?: string,
  ): Record<string, unknown> | undefined {
    const meta: Record<string, unknown> = {
      sessionMode: session.mode,
    };

    if (options.sessionMeta?.userId) meta.userId = options.sessionMeta.userId;
    if (options.sessionMeta?.installationId)
      meta.installationId = options.sessionMeta.installationId;
    if (operationId) meta.operationId = operationId;
    if (repositorySource) meta.repositorySource = repositorySource;

    return Object.keys(meta).length ? meta : undefined;
  }

  private buildAutomationSkipped(reason: string): GitHubAutomationResult {
    const now = new Date();
    return {
      status: 'skipped',
      skippedReason: reason,
      diagnostics: {
        durationMs: 0,
        attempts: 1,
        logs: [`skipped: ${reason}`.slice(0, 300)],
        startTimestamp: now.toISOString(),
        endTimestamp: now.toISOString(),
      },
    };
  }

  private buildDiagnosticsSnapshot(status: string, error: unknown) {
    const now = new Date();
    return {
      durationMs: 0,
      attempts: 1,
      logs: [
        `${status}: ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          300,
        ),
      ],
      startTimestamp: now.toISOString(),
      endTimestamp: now.toISOString(),
      errorCode: 'automation-execution-failed',
    };
  }

  private mergeLegacyGithubOperations(
    existing: SessionPromptResponse['result']['githubOperations'] | undefined,
    automation: GitHubAutomationResult,
  ): SessionPromptResponse['result']['githubOperations'] {
    const merged = existing ? { ...existing } : {};
    if (automation.branch) merged.branchCreated = automation.branch;
    if (automation.pullRequest) {
      merged.pullRequestCreated = {
        url: automation.pullRequest.url,
        number: automation.pullRequest.number,
        title: automation.pullRequest.branch,
      };
    }
    if (
      !merged.filesModified &&
      automation.metadata &&
      Array.isArray((automation.metadata as any).filesChanged)
    ) {
      merged.filesModified = (automation.metadata as any).filesChanged.slice(
        0,
        50,
      ); // eslint-disable-line @typescript-eslint/no-explicit-any
    }
    return merged;
  }

  private findRepositoryCandidate(
    agentContext: Record<string, unknown> | undefined,
    options: ProcessPromptOptions,
    workspace: WorkspaceDescriptor,
  ):
    | {
        owner: string;
        name: string;
        defaultBranch?: string;
        cloneUrl?: string;
        source?: string;
      }
    | undefined {
    const candidates: Array<{
      owner: string;
      name: string;
      defaultBranch?: string;
      cloneUrl?: string;
      source?: string;
    }> = [];

    const pushCandidate = (value: unknown, source: string) => {
      const parsed = this.parseRepository(value);
      if (parsed) candidates.push({ ...parsed, source });
    };

    pushCandidate(
      this.getNested(agentContext, ['repository']),
      'agentContext.repository',
    );
    pushCandidate(this.getNested(agentContext, ['repo']), 'agentContext.repo');
    pushCandidate(
      this.getNested(agentContext, ['automation', 'repository']),
      'agentContext.automation.repository',
    );
    pushCandidate(
      this.getNested(agentContext, ['github', 'repository']),
      'agentContext.github.repository',
    );
    pushCandidate(
      this.getNested(options.rawParams, ['repository']),
      'params.repository',
    );
    pushCandidate(
      this.getNested(options.rawParams, ['context', 'repository']),
      'params.context.repository',
    );
    pushCandidate(
      this.getNested(options.rawParams, ['context', 'github', 'repository']),
      'params.context.github.repository',
    );

    if (!candidates.length && workspace.gitInfo?.remoteUrl) {
      const parsed = this.parseRepository(workspace.gitInfo.remoteUrl);
      if (parsed) {
        candidates.push({ ...parsed, source: 'workspace.remote' });
      }
    }

    return candidates[0];
  }

  private parseRepository(
    value: unknown,
  ):
    | { owner: string; name: string; defaultBranch?: string; cloneUrl?: string }
    | undefined {
    if (!value) return undefined;
    if (typeof value === 'string') {
      const cleaned = value.trim();
      if (!cleaned) return undefined;
      const repoMatch = cleaned.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
      if (repoMatch) {
        return { owner: repoMatch[1], name: repoMatch[2] };
      }
      const fromUrl = this.parseRepositoryFromUrl(cleaned);
      if (fromUrl) return fromUrl;
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const owner = this.findString([obj.owner]);
      const name = this.findString([obj.name, obj.repo]);
      if (owner && name) {
        const defaultBranch = this.findString([obj.defaultBranch, obj.branch]);
        const cloneUrl = this.findString([obj.cloneUrl, obj.url]);
        return { owner, name, defaultBranch, cloneUrl };
      }
    }
    return undefined;
  }

  private parseRepositoryFromUrl(
    url: string,
  ): { owner: string; name: string; cloneUrl?: string } | undefined {
    const normalized = url.replace(/\.git$/, '');
    const httpsMatch = normalized.match(
      /github\.com[:/]{1,2}([^/]+)\/([^/]+)$/i,
    );
    if (httpsMatch) {
      return {
        owner: httpsMatch[1],
        name: httpsMatch[2],
        cloneUrl: `https://github.com/${httpsMatch[1]}/${httpsMatch[2]}.git`,
      };
    }
    const sshMatch = normalized.match(/git@github\.com:([^/]+)\/([^/]+)$/i);
    if (sshMatch) {
      return {
        owner: sshMatch[1],
        name: sshMatch[2],
        cloneUrl: `https://github.com/${sshMatch[1]}/${sshMatch[2]}.git`,
      };
    }
    return undefined;
  }

  private ensureStringArray(value: unknown): string[] | undefined {
    if (!value) return undefined;
    if (Array.isArray(value)) {
      const filtered = value
        .filter((v) => typeof v === 'string')
        .map((v) => (v as string).trim())
        .filter(Boolean);
      return filtered.length ? filtered : undefined;
    }
    if (typeof value === 'string') {
      const parts = value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      return parts.length ? parts : undefined;
    }
    return undefined;
  }

  private normalizeIssueReference(
    value: unknown,
  ): GitHubIssueReference | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    const id = Number(record.id);
    const number = Number(record.number);
    const url = this.findString([record.url, record.html_url]);
    const title = this.findString([record.title]);
    if (!Number.isFinite(id) || !Number.isFinite(number) || !url || !title)
      return undefined;
    return { id, number, url, title };
  }

  private normalizeGitIdentity(
    value: unknown,
  ): { name?: string; email?: string } | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    const name = this.findString([record.name]);
    const email = this.findString([record.email]);
    if (!name && !email) return undefined;
    return { name, email };
  }

  private getNested(obj: unknown, path: Array<string | number>): unknown {
    if (!obj || typeof obj !== 'object') return undefined;
    let current: any = obj; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const key of path) {
      if (current == null) return undefined;
      current = current[key];
    }
    return current;
  }

  private findString(values: Array<unknown>): string | undefined {
    for (const value of values) {
      if (typeof value === 'string' && value.trim().length) return value.trim();
    }
    return undefined;
  }

  private toBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(lower)) return true;
      if (['false', '0', 'no', 'off'].includes(lower)) return false;
    }
    return undefined;
  }

  private logAutomation(
    event: string,
    sessionId: string,
    operationId: string | undefined,
    details?: Record<string, unknown>,
  ) {
    const suffix = operationId ? `:${operationId}` : '';
    if (details) {
      console.error(
        `[GITHUB-AUTO][${sessionId}${suffix}] ${event}`,
        JSON.stringify(details),
      );
    } else {
      console.error(`[GITHUB-AUTO][${sessionId}${suffix}] ${event}`);
    }
  }
}

export default PromptProcessor;
