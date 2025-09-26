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
import type { IWorkspaceService, WorkspaceDescriptor } from '../workspace/workspace-service.js';
import type { IClaudeClient, ClaudeRunCallbacks } from '../claude/claude-client.js';
import type { GitService } from '../git/git-service.js';
import type { DiagnosticsService } from '../../core/diagnostics/diagnostics-service.js';
import type {
  GitHubAutomationService,
  GitHubAutomationContext,
  GitHubAutomationResult,
  AutomationIntentSignals,
  GitHubIssueReference,
} from '../github/github-automation.js';
import { buildPromptFromContent, estimateTokens } from '../../core/prompts/prompt-utils.js';
import { defaultErrorClassifier } from '../../core/errors/error-classifier.js';
import type { ContentBlock, SessionPromptResponse } from '../../types/acp-messages';
import type { ACPSession } from '../../types/acp-session.js';

const GITHUB_AUTOMATION_VERSION = '1.0.0';

// TODO(acp-refactor/phase-6): Add Diagnostics + ErrorClassifier + PromptUtils dependencies.
export interface PromptProcessorDeps {
  sessionStore: ISessionStore;
  workspaceService: IWorkspaceService;
  claudeClient: IClaudeClient;
  gitService?: GitService;
  diagnosticsService?: DiagnosticsService;
  githubAutomationService?: GitHubAutomationService;
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

    const operationId = opts.operationId ?? `prompt-${Date.now()}`;
    const logFullContent = process.env.ACP_LOG_FULL_CONTENT === '1';
    const logPrefix = `[PROMPT][${sessionId}${operationId ? `:${operationId}` : ''}]`;
    const logFull = (...parts: Array<string | number | boolean | undefined>) => {
      if (!logFullContent) return;
      const message = parts
        .filter((p) => p !== undefined)
        .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
        .join(' ');
      console.error(`${logPrefix} ${message}`);
    };

    if (!sessionId) throw new Error('sessionId required');
    if (!Array.isArray(content) || content.length === 0) throw new Error('content must be non-empty array');

    // 1. Load session (from store or error)
    const session = await this.loadSession(sessionId);

    const mergedAgentContext = this.mergeAgentContext(session.agentContext, agentContext);
    if (mergedAgentContext) {
      session.agentContext = mergedAgentContext;
    }
    const activeAgentContext = session.agentContext ?? agentContext;

    // 2. Build prompt text from content blocks
    const prompt = buildPromptFromContent(content, contextFiles, activeAgentContext, session);
    const inputEst = estimateTokens(prompt).estimatedTokens;
    logFull('prompt', prompt);

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
            progress: { current: Math.max(1, Math.floor(outputTokens / 50)), total: 3, message: 'Streaming' },
          });
      },
      onComplete: () => {
        finished = true;
        logFull('run_complete', `outputTokens=${outputTokens}`, 'full_text', fullText);
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
  await this.deps.claudeClient.runPrompt(prompt, { sessionId, operationId, workspacePath: wsDesc.path, apiKey, abortSignal }, callbacks);
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
      logFull('run_failed', classified.code, classified.message, stderr, rawDiagnostics ? JSON.stringify(rawDiagnostics) : undefined);
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
    console.error(`[PROMPT-SUMMARY][${sessionId}${operationId ? `:${operationId}` : ''}] ${response.summary ?? ''}`);
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

    const automationResult = await this.executeGitHubAutomation({
      session,
      workspace: wsDesc,
      promptText: prompt,
      summaryText: fullText,
      agentContext: activeAgentContext,
      options: opts,
      operationId,
    });

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
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
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

    const { session, workspace, promptText, summaryText, agentContext, options, operationId } = args;

    if (session.sessionOptions?.enableGitOps === false) {
      return this.buildAutomationSkipped('GitOps disabled for session');
    }

    const token = this.resolveGitHubToken(agentContext, options);
    if (!token) {
      return this.buildAutomationSkipped('Missing GitHub token');
    }

    const resolvedRepo = this.resolveRepositoryDescriptor(agentContext, options, workspace);
    if (!resolvedRepo) {
      return this.buildAutomationSkipped('Missing repository metadata');
    }

    const intent = this.resolveAutomationIntent(agentContext, options);
    const metadata = this.buildAutomationMetadata(session, options, resolvedRepo.source, operationId);

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
          message: error instanceof Error ? error.message : 'Unknown automation failure',
        },
        diagnostics: this.buildDiagnosticsSnapshot('error', error),
      } as GitHubAutomationResult;
    }
  }

  private resolveGitHubToken(
    agentContext: Record<string, unknown> | undefined,
    options: ProcessPromptOptions,
  ): string | undefined {
    const fromOptions = options.githubToken;
    if (fromOptions && typeof fromOptions === 'string') return fromOptions;

    const ctxToken = this.findString([
      this.getNested(agentContext, ['githubToken']),
      this.getNested(agentContext, ['token']),
      this.getNested(agentContext, ['github', 'token']),
      this.getNested(options.rawParams, ['githubToken']),
      this.getNested(options.rawParams, ['context', 'githubToken']),
      this.getNested(options.rawParams, ['context', 'github', 'token']),
    ]);
    if (ctxToken) return ctxToken;
    return process.env.GITHUB_TOKEN;
  }

  private resolveRepositoryDescriptor(
    agentContext: Record<string, unknown> | undefined,
    options: ProcessPromptOptions,
    workspace: WorkspaceDescriptor,
  ): (
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
    | undefined
  ) {
  const repoCandidate = this.findRepositoryCandidate(agentContext, options, workspace);
  if (!repoCandidate) return undefined;

  const defaultBranch = repoCandidate.defaultBranch
      || this.findString([
        this.getNested(agentContext, ['branch']),
        this.getNested(agentContext, ['automation', 'baseBranch']),
        this.getNested(agentContext, ['automation', 'defaultBranch']),
        this.getNested(options.rawParams, ['branch']),
        this.getNested(options.rawParams, ['context', 'branch']),
        workspace.gitInfo?.currentBranch,
      ])
      || 'main';

    const cloneUrl = repoCandidate.cloneUrl
      || this.findString([
        this.getNested(agentContext, ['cloneUrl']),
        this.getNested(agentContext, ['automation', 'cloneUrl']),
        this.getNested(agentContext, ['github', 'cloneUrl']),
        this.getNested(options.rawParams, ['cloneUrl']),
        this.getNested(options.rawParams, ['context', 'cloneUrl']),
        workspace.gitInfo?.remoteUrl,
      ]);

    const labels = this.ensureStringArray(
      this.getNested(agentContext, ['automation', 'labels'])
        ?? this.getNested(options.rawParams, ['context', 'automation', 'labels'])
        ?? this.getNested(options.rawParams, ['labels']),
    );

    const issueTitle = this.findString([
      this.getNested(agentContext, ['automation', 'issueTitle']),
      this.getNested(options.rawParams, ['context', 'automation', 'issueTitle']),
      this.getNested(options.rawParams, ['issueTitle']),
    ]);

    const branchNameOverride = this.findString([
      this.getNested(agentContext, ['automation', 'branchName']),
      this.getNested(options.rawParams, ['context', 'automation', 'branchName']),
    ]);

    const baseBranchOverride = this.findString([
      this.getNested(agentContext, ['automation', 'baseBranch']),
      this.getNested(options.rawParams, ['context', 'automation', 'baseBranch']),
      this.getNested(options.rawParams, ['baseBranch']),
    ]);

    const issueRef = this.normalizeIssueReference(
      this.getNested(agentContext, ['automation', 'issue'])
        ?? this.getNested(options.rawParams, ['context', 'automation', 'issue'])
        ?? this.getNested(options.rawParams, ['issue']),
    );

    const gitIdentity = this.normalizeGitIdentity(
      this.getNested(agentContext, ['automation', 'git'])
        ?? this.getNested(options.rawParams, ['context', 'automation', 'git']),
    );

    const dryRun = this.toBoolean(
      this.getNested(agentContext, ['automation', 'dryRun'])
        ?? this.getNested(options.rawParams, ['context', 'automation', 'dryRun'])
        ?? this.getNested(options.rawParams, ['dryRun']),
    );

    const allowEmptyCommit = this.toBoolean(
      this.getNested(agentContext, ['automation', 'allowEmptyCommit'])
        ?? this.getNested(options.rawParams, ['context', 'automation', 'allowEmptyCommit']),
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
    const automationNode = this.asRecord(this.getNested(agentContext, ['automation']))
      ?? this.asRecord(this.getNested(options.rawParams, ['context', 'automation']));
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
    if (options.sessionMeta?.installationId) meta.installationId = options.sessionMeta.installationId;
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
      logs: [`${status}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300)],
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
    if (!merged.filesModified && automation.metadata && Array.isArray((automation.metadata as any).filesChanged)) {
      merged.filesModified = (automation.metadata as any).filesChanged.slice(0, 50); // eslint-disable-line @typescript-eslint/no-explicit-any
    }
    return merged;
  }

  private findRepositoryCandidate(
    agentContext: Record<string, unknown> | undefined,
    options: ProcessPromptOptions,
    workspace: WorkspaceDescriptor,
  ): { owner: string; name: string; defaultBranch?: string; cloneUrl?: string; source?: string } | undefined {
    const candidates: Array<{ owner: string; name: string; defaultBranch?: string; cloneUrl?: string; source?: string }> = [];

    const pushCandidate = (value: unknown, source: string) => {
      const parsed = this.parseRepository(value);
      if (parsed) candidates.push({ ...parsed, source });
    };

    pushCandidate(this.getNested(agentContext, ['repository']), 'agentContext.repository');
    pushCandidate(this.getNested(agentContext, ['repo']), 'agentContext.repo');
    pushCandidate(this.getNested(agentContext, ['automation', 'repository']), 'agentContext.automation.repository');
    pushCandidate(this.getNested(agentContext, ['github', 'repository']), 'agentContext.github.repository');
    pushCandidate(this.getNested(options.rawParams, ['repository']), 'params.repository');
    pushCandidate(this.getNested(options.rawParams, ['context', 'repository']), 'params.context.repository');
    pushCandidate(this.getNested(options.rawParams, ['context', 'github', 'repository']), 'params.context.github.repository');

    if (!candidates.length && workspace.gitInfo?.remoteUrl) {
      const parsed = this.parseRepository(workspace.gitInfo.remoteUrl);
      if (parsed) {
        candidates.push({ ...parsed, source: 'workspace.remote' });
      }
    }

    return candidates[0];
  }

  private parseRepository(value: unknown): { owner: string; name: string; defaultBranch?: string; cloneUrl?: string } | undefined {
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

  private parseRepositoryFromUrl(url: string): { owner: string; name: string; cloneUrl?: string } | undefined {
    const normalized = url.replace(/\.git$/, '');
    const httpsMatch = normalized.match(/github\.com[:/]{1,2}([^/]+)\/([^/]+)$/i);
    if (httpsMatch) {
      return { owner: httpsMatch[1], name: httpsMatch[2], cloneUrl: `https://github.com/${httpsMatch[1]}/${httpsMatch[2]}.git` };
    }
    const sshMatch = normalized.match(/git@github\.com:([^/]+)\/([^/]+)$/i);
    if (sshMatch) {
      return { owner: sshMatch[1], name: sshMatch[2], cloneUrl: `https://github.com/${sshMatch[1]}/${sshMatch[2]}.git` };
    }
    return undefined;
  }

  private ensureStringArray(value: unknown): string[] | undefined {
    if (!value) return undefined;
    if (Array.isArray(value)) {
      const filtered = value.filter((v) => typeof v === 'string').map((v) => (v as string).trim()).filter(Boolean);
      return filtered.length ? filtered : undefined;
    }
    if (typeof value === 'string') {
      const parts = value.split(',').map((v) => v.trim()).filter(Boolean);
      return parts.length ? parts : undefined;
    }
    return undefined;
  }

  private normalizeIssueReference(value: unknown): GitHubIssueReference | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    const id = Number(record.id);
    const number = Number(record.number);
    const url = this.findString([record.url, record.html_url]);
    const title = this.findString([record.title]);
    if (!Number.isFinite(id) || !Number.isFinite(number) || !url || !title) return undefined;
    return { id, number, url, title };
  }

  private normalizeGitIdentity(value: unknown): { name?: string; email?: string } | undefined {
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

  private logAutomation(event: string, sessionId: string, operationId: string | undefined, details?: Record<string, unknown>) {
    const suffix = operationId ? `:${operationId}` : '';
    if (details) {
      console.error(`[GITHUB-AUTO][${sessionId}${suffix}] ${event}`, JSON.stringify(details));
    } else {
      console.error(`[GITHUB-AUTO][${sessionId}${suffix}] ${event}`);
    }
  }
}

export default PromptProcessor;
