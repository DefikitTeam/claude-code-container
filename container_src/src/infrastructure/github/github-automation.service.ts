import { Octokit } from '@octokit/rest';
import type { GitService } from '../../services/git/git-service.js';
import type {
  AutomationDecision,
  AutomationDiagnostics,
  AutomationIntentSignals,
  GitHubAutomationContext,
  GitHubAutomationResult,
  GitHubCommitReference,
  GitHubIssueReference,
  GitHubPullRequestReference,
  GitIdentity,
  IGitHubAutomationService,
} from '../../core/interfaces/services/github-automation.service.js';

export interface GitHubAutomationOptions {
  gitService: GitService;
  octokitFactory?: (token: string) => Octokit;
  logger?: (event: string, details?: Record<string, unknown>) => void;
  now?: () => Date;
  branchPrefix?: string;
  defaultLabels?: string[];
  gitIdentity?: GitIdentity;
}

const DEFAULT_LABELS = ['automated', 'claude-prompt'];
const DEFAULT_IDENTITY: GitIdentity = {
  name: 'Claude Code Bot',
  email: 'claude-code@anthropic.com',
};
const DEFAULT_BRANCH_PREFIX = 'claude-code';

class AutomationError extends Error {
  code: string;
  retryable?: boolean;
  details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options: { retryable?: boolean; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'AutomationError';
    this.code = code;
    this.retryable = options.retryable;
    this.details = options.details;
  }
}

interface PreparedWorkspace {
  path: string;
  baseBranch: string;
  branchName: string;
  changedFiles: string[];
  hasChanges: boolean;
}

interface CommitMetadata extends GitHubCommitReference {
  filesChanged: string[];
}

interface PullRequestMetadata extends GitHubPullRequestReference {}

export class GitHubAutomationService implements IGitHubAutomationService {
  private readonly git: GitService;
  private readonly octokitFactory: (token: string) => Octokit;
  private readonly logger?: (
    event: string,
    details?: Record<string, unknown>,
  ) => void;
  private readonly branchPrefix: string;
  private readonly defaultLabels: string[];
  private readonly gitIdentity: GitIdentity;
  private readonly nowFn: () => Date;

  constructor(options: GitHubAutomationOptions) {
    this.git = options.gitService;
    this.logger = options.logger;
    this.branchPrefix = options.branchPrefix || DEFAULT_BRANCH_PREFIX;
    this.defaultLabels = options.defaultLabels || DEFAULT_LABELS;
    this.gitIdentity = options.gitIdentity || DEFAULT_IDENTITY;
    this.nowFn = options.now || (() => new Date());
    this.octokitFactory =
      options.octokitFactory ||
      ((token: string) => new Octokit({ auth: token }));
  }

  detectIntent(signals: AutomationIntentSignals = {}): AutomationDecision {
    const contextMode =
      extractModeFromAgentContext(signals.agentContext) || signals.mode;
    if (signals.disabled) {
      return {
        run: false,
        mode: 'none',
        reason: signals.reason || 'Automation disabled by configuration',
        explicit: signals.explicit,
      };
    }

    if (signals.repositoryBlocked) {
      return {
        run: false,
        mode: 'none',
        reason: signals.reason || 'Repository not eligible for automation',
        explicit: signals.explicit,
      };
    }

    const normalizedMode = (contextMode || 'github').toLowerCase();
    if (normalizedMode === 'none' || normalizedMode === 'skip') {
      return {
        run: false,
        mode: 'none',
        reason:
          signals.reason || 'Automation explicitly skipped by agent context',
        explicit: signals.explicit,
      };
    }

    return {
      run: true,
      mode: 'github',
      explicit: signals.explicit,
    };
  }

  async execute(
    context: GitHubAutomationContext,
  ): Promise<GitHubAutomationResult> {
    const start = this.nowFn();
    const logs: string[] = [];
    const decision = this.detectIntent(context.intent);
    if (!decision.run) {
      return this.buildSkippedResult(
        decision.reason || 'Automation disabled',
        start,
        logs,
        context,
      );
    }

    if (!context.repository.owner || !context.repository.name) {
      return this.buildErrorResult(
        start,
        logs,
        new AutomationError(
          'missing-repository',
          'Repository owner/name are required',
        ),
      );
    }

    const octokit = context.dryRun
      ? undefined
      : this.octokitFactory(context.auth.installationToken);

    let issue = context.existingIssue;
    let prepared: PreparedWorkspace | undefined;
    let commit: CommitMetadata | null = null;
    let pullRequest: PullRequestMetadata | undefined;

    try {
      this.log(logs, 'automation.start', {
        sessionId: context.sessionId,
        repository: `${context.repository.owner}/${context.repository.name}`,
      });

      if (!issue) {
        issue = await this.createIssue(octokit, context, logs);
      }

      prepared = await this.prepareWorkspace(context, issue, logs);
      if (!prepared.hasChanges && !context.allowEmptyCommit) {
        return this.buildSkippedResult(
          'No workspace changes detected',
          start,
          logs,
          context,
          issue,
        );
      }

      commit = await this.commitChanges(
        context,
        prepared,
        logs,
        issue || undefined,
      );
      if (!commit && !context.allowEmptyCommit) {
        return this.buildSkippedResult(
          'Nothing to commit after staging',
          start,
          logs,
          context,
          issue,
        );
      }

      if (!context.dryRun) {
        await this.pushBranch(context, prepared, logs);
        pullRequest = await this.openPullRequest(
          octokit!,
          context,
          prepared,
          commit!,
          issue!,
          logs,
        );
        await this.commentOnIssue(octokit!, context, issue!, pullRequest, logs);
      } else {
        this.log(logs, 'automation.dryRun', {
          branch: prepared.branchName,
          reason: 'dry-run-enabled',
        });
      }

      const result: GitHubAutomationResult = {
        status: 'success',
        branch: prepared.branchName,
        issue: issue || undefined,
        commit: commit || undefined,
        pullRequest: pullRequest,
        diagnostics: this.buildDiagnostics(start, logs, undefined),
        metadata: context.metadata,
      };

      this.log(logs, 'automation.success', {
        branch: prepared.branchName,
        issueNumber: issue?.number,
        pullRequestNumber: pullRequest?.number,
      });

      return result;
    } catch (error) {
      const automationError = normalizeAutomationError(error);
      this.log(logs, 'automation.error', {
        code: automationError.code,
        message: automationError.message,
      });
      return this.buildErrorResult(
        start,
        logs,
        automationError,
        issue,
        prepared?.branchName,
      );
    }
  }

  async prepareWorkspace(
    context: GitHubAutomationContext,
    issue: GitHubIssueReference | undefined,
    logs: string[],
  ): Promise<PreparedWorkspace> {
    const workspacePath = context.workspacePath;
    const baseBranch =
      context.baseBranchOverride || context.repository.defaultBranch;
    const authedCloneUrl = buildAuthedUrl(
      context.repository.cloneUrl,
      context.auth.installationToken,
    );

    if (context.repository.cloneUrl) {
      this.log(logs, 'git.ensureRepo', {
        path: workspacePath,
        cloneUrl: redactToken(context.repository.cloneUrl),
      });
      await this.git.ensureRepo(workspacePath, {
        defaultBranch: baseBranch,
        cloneUrl: authedCloneUrl,
      });
    }

    await this.git.runGit(workspacePath, ['fetch', 'origin', baseBranch]);
    await this.git.checkoutBranch(workspacePath, baseBranch);
    await this.git.runGit(workspacePath, [
      'pull',
      '--ff-only',
      'origin',
      baseBranch,
    ]);

    const branchName =
      context.branchNameOverride ||
      buildBranchName(
        this.branchPrefix,
        issue,
        context.sessionId,
        this.nowFn(),
      );

    try {
      await this.git.createBranch(workspacePath, branchName, baseBranch);
    } catch (error) {
      this.log(logs, 'git.branchExisting', { branch: branchName });
      await this.git.checkoutBranch(workspacePath, branchName);
    }

    const hasChanges = await this.git.hasUncommittedChanges(workspacePath);
    const changedFiles = await collectChangedFiles(this.git, workspacePath);

    return {
      path: workspacePath,
      baseBranch,
      branchName,
      hasChanges,
      changedFiles,
    };
  }

  async commitChanges(
    context: GitHubAutomationContext,
    prepared: PreparedWorkspace,
    logs: string[],
    issue?: GitHubIssueReference,
  ): Promise<CommitMetadata | null> {
    const identity: GitIdentity = {
      name: context.git?.name || this.gitIdentity.name,
      email: context.git?.email || this.gitIdentity.email,
    };

    await this.git.runGit(prepared.path, [
      'config',
      'user.name',
      identity.name,
    ]);
    await this.git.runGit(prepared.path, [
      'config',
      'user.email',
      identity.email,
    ]);

    await this.git.runGit(prepared.path, ['add', '--all']);

    const hasChanges = await this.git.hasUncommittedChanges(prepared.path);
    if (!hasChanges && !context.allowEmptyCommit) {
      this.log(logs, 'git.noChangesAfterAdd');
      return null;
    }

    const commitMessage = buildCommitMessage(issue, context.prompt.title);
    const commitResult = await this.git.runGit(prepared.path, [
      'commit',
      '-m',
      commitMessage,
    ]);

    if (commitResult.code && commitResult.code !== 0) {
      throw new AutomationError('git-commit-failed', 'Git commit failed', {
        details: {
          code: commitResult.code,
          stderr: commitResult.stderr,
        },
      });
    }

    const rev = await this.git.runGit(prepared.path, ['rev-parse', 'HEAD']);
    const sha = rev.stdout.trim();

    const filesChanged = await collectChangedFiles(this.git, prepared.path, {
      staged: true,
    });

    this.log(logs, 'git.commit', {
      message: commitMessage,
      sha,
      filesChanged,
    });

    return {
      sha,
      message: commitMessage,
      filesChanged,
    };
  }

  async pushBranch(
    context: GitHubAutomationContext,
    prepared: PreparedWorkspace,
    logs: string[],
  ): Promise<void> {
    const sanitizedRemote = context.repository.cloneUrl
      ? sanitizeRemote(context.repository.cloneUrl)
      : `https://github.com/${context.repository.owner}/${context.repository.name}.git`;
    const authedRemote = buildAuthedUrl(
      sanitizedRemote,
      context.auth.installationToken,
    );

    let previousPushUrl: string | undefined;
    if (authedRemote) {
      const current = await this.git.runGit(prepared.path, [
        'remote',
        'get-url',
        '--push',
        'origin',
      ]);
      previousPushUrl = current.stdout.trim() || undefined;
      await this.throwIfGitFailed(
        await this.git.runGit(prepared.path, [
          'remote',
          'set-url',
          '--push',
          'origin',
          authedRemote,
        ]),
        'git-remote-set-url-failed',
      );
    }

    try {
      const pushResult = await this.git.runGit(prepared.path, [
        'push',
        '--set-upstream',
        'origin',
        prepared.branchName,
      ]);
      await this.throwIfGitFailed(pushResult, 'git-push-failed');
      this.log(logs, 'git.push', { branch: prepared.branchName });
    } finally {
      if (authedRemote && previousPushUrl) {
        await this.git.runGit(prepared.path, [
          'remote',
          'set-url',
          '--push',
          'origin',
          previousPushUrl,
        ]);
      }
    }
  }

  async openPullRequest(
    octokit: Octokit,
    context: GitHubAutomationContext,
    prepared: PreparedWorkspace,
    commit: CommitMetadata,
    issue: GitHubIssueReference,
    logs: string[],
  ): Promise<PullRequestMetadata> {
    const prTitle = derivePullRequestTitle(
      issue,
      context.prompt.title,
      context.summaryMarkdown,
    );
    const prBody = buildPullRequestBody(
      issue,
      context.summaryMarkdown || context.prompt.body,
    );

    const response = await octokit.rest.pulls.create({
      owner: context.repository.owner,
      repo: context.repository.name,
      base: prepared.baseBranch,
      head: prepared.branchName,
      title: prTitle,
      body: prBody,
      draft: false,
    });

    const data = response.data;
    this.log(logs, 'github.pullRequestCreated', {
      number: data.number,
      url: data.html_url,
    });

    return {
      number: data.number,
      url: data.html_url,
      branch: prepared.branchName,
      draft: data.draft || false,
    };
  }

  async commentOnIssue(
    octokit: Octokit,
    context: GitHubAutomationContext,
    issue: GitHubIssueReference,
    pullRequest: PullRequestMetadata,
    logs: string[],
  ): Promise<void> {
    const body = `🔧 Created PR: ${pullRequest.url}`;
    await octokit.rest.issues.createComment({
      owner: context.repository.owner,
      repo: context.repository.name,
      issue_number: issue.number,
      body,
    });
    this.log(logs, 'github.issueComment', {
      issueNumber: issue.number,
      pullRequestUrl: pullRequest.url,
    });
  }

  private async createIssue(
    octokit: Octokit | undefined,
    context: GitHubAutomationContext,
    logs: string[],
  ): Promise<GitHubIssueReference | undefined> {
    if (!octokit) {
      this.log(logs, 'github.issueSkipped', { reason: 'dry-run' });
      return {
        id: 0,
        number: 0,
        url: '',
        title: context.prompt.title || 'Automation Preview Issue',
      };
    }

    const title =
      context.prompt.title?.trim() || deriveIssueTitle(context.prompt.body);
    const body = buildIssueBody(context.prompt.body, context.summaryMarkdown);
    const labels = context.labels || this.defaultLabels;

    const response = await octokit.rest.issues.create({
      owner: context.repository.owner,
      repo: context.repository.name,
      title,
      body,
      labels,
    });

    const data = response.data;
    this.log(logs, 'github.issueCreated', {
      number: data.number,
      url: data.html_url,
    });

    return {
      id: data.id,
      number: data.number,
      url: data.html_url,
      title: data.title,
    };
  }

  private buildSkippedResult(
    reason: string,
    start: Date,
    logs: string[],
    context: GitHubAutomationContext,
    issue?: GitHubIssueReference,
  ): GitHubAutomationResult {
    return {
      status: 'skipped',
      issue,
      skippedReason: reason,
      diagnostics: this.buildDiagnostics(start, logs, undefined),
      metadata: context.metadata,
    };
  }

  private buildErrorResult(
    start: Date,
    logs: string[],
    error: AutomationError,
    issue?: GitHubIssueReference,
    branch?: string,
  ): GitHubAutomationResult {
    return {
      status: 'error',
      issue,
      branch,
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        details: error.details,
      },
      diagnostics: this.buildDiagnostics(start, logs, error.code),
    };
  }

  private buildDiagnostics(
    start: Date,
    logs: string[],
    errorCode?: string,
  ): AutomationDiagnostics {
    const end = this.nowFn();
    return {
      durationMs: end.getTime() - start.getTime(),
      attempts: 1,
      logs: [...logs],
      errorCode,
      startTimestamp: start.toISOString(),
      endTimestamp: end.toISOString(),
    };
  }

  private log(
    messageStore: string[],
    event: string,
    details?: Record<string, unknown>,
  ) {
    const entry = details
      ? `${event}: ${JSON.stringify(redactSensitiveFields(details))}`
      : event;
    messageStore.push(entry);
    this.logger?.(event, details ? redactSensitiveFields(details) : undefined);
  }

  private async throwIfGitFailed(
    result: { code: number | null; stderr: string },
    code: string,
  ) {
    if (result.code && result.code !== 0) {
      throw new AutomationError(code, 'Git command failed', {
        details: {
          code: result.code,
          stderr: result.stderr,
        },
      });
    }
  }
}

function extractModeFromAgentContext(
  agentContext: Record<string, unknown> | undefined,
): string | undefined {
  if (!agentContext) return undefined;
  const automation = agentContext['automation'];
  if (automation && typeof automation === 'object') {
    const mode = (automation as Record<string, unknown>).mode;
    if (typeof mode === 'string') return mode;
  }
  const mode = agentContext['automationMode'];
  return typeof mode === 'string' ? mode : undefined;
}

function buildIssueBody(prompt: string, summaryMarkdown?: string): string {
  const sections: string[] = [];
  if (summaryMarkdown) {
    sections.push('### Summary\n');
    sections.push(summaryMarkdown.trim());
    sections.push('\n');
  }
  sections.push('### Original Request\n');
  sections.push(prompt.trim());
  sections.push('\n\n_Powered by Claude Code automation._');
  return sections.join('\n');
}

function buildPullRequestBody(
  issue: GitHubIssueReference,
  summary: string,
): string {
  const sanitizedSummary =
    summary.trim() || 'Automated fix generated by Claude Code.';
  return `${sanitizedSummary}\n\n---\nFixes #${issue.number}\n\n🤖 This pull request was generated automatically by Claude Code.`;
}

function deriveIssueTitle(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/, 1)[0];
  if (!firstLine) return 'Automated change request';
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
}

function derivePullRequestTitle(
  issue: GitHubIssueReference,
  promptTitle?: string,
  summary?: string,
): string {
  if (summary) {
    const firstLine = summary.trim().split(/\r?\n/, 1)[0];
    if (firstLine) {
      return firstLine.length > 120
        ? `${firstLine.slice(0, 117)}...`
        : firstLine;
    }
  }
  if (promptTitle) {
    return promptTitle.length > 120
      ? `${promptTitle.slice(0, 117)}...`
      : promptTitle;
  }
  return `Fix issue #${issue.number}`;
}

function buildCommitMessage(
  issue?: GitHubIssueReference,
  promptTitle?: string,
): string {
  if (issue) {
    const suffix = promptTitle ? `: ${promptTitle}` : '';
    return `Fix issue #${issue.number}${suffix}`;
  }
  return promptTitle
    ? `Apply automation: ${promptTitle}`
    : 'Apply automated changes';
}

function buildBranchName(
  prefix: string,
  issue: GitHubIssueReference | undefined,
  sessionId: string,
  now: Date,
): string {
  const timestamp = formatTimestamp(now);
  if (issue && issue.number > 0) {
    return `${prefix}/issue-${issue.number}-${timestamp}`.toLowerCase();
  }
  const sanitizedSession = sessionId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return `${prefix}/session-${sanitizedSession || 'unknown'}-${timestamp}`;
}

function formatTimestamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  const hours = `${date.getUTCHours()}`.padStart(2, '0');
  const minutes = `${date.getUTCMinutes()}`.padStart(2, '0');
  const seconds = `${date.getUTCSeconds()}`.padStart(2, '0');
  return `${year}-${month}-${day}-${hours}${minutes}${seconds}`;
}

function buildAuthedUrl(
  url: string | undefined,
  token: string,
): string | undefined {
  if (!url) return undefined;
  const sanitized = sanitizeRemote(url);
  // CRITICAL FIX: Strip trailing slashes that cause git push to fail
  // Error: "URL rejected: Port number was not a decimal number between 0 and 65535"
  const withoutProtocol = sanitized.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return `https://x-access-token:${token}@${withoutProtocol}`;
}

function sanitizeRemote(url: string): string {
  if (url.startsWith('git@github.com:')) {
    return `https://github.com/${url.slice('git@github.com:'.length)}`;
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}

async function collectChangedFiles(
  git: GitService,
  workspacePath: string,
  options: { staged?: boolean } = {},
): Promise<string[]> {
  if (options.staged) {
    const result = await git.runGit(workspacePath, [
      'diff',
      '--cached',
      '--name-only',
    ]);
    return parseChangedFileList(result.stdout);
  }
  const status = await git.runGit(workspacePath, ['status', '--porcelain']);
  return parseChangedFileList(status.stdout);
}

function parseChangedFileList(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\?\?\s+/, '').replace(/^..\s+/, ''))
    .map((relative) => relative.replace(/^\.\//, ''));
}

function redactSensitiveFields(
  details: Record<string, unknown>,
): Record<string, unknown> {
  const clone = { ...details };
  if (clone['cloneUrl'] && typeof clone['cloneUrl'] === 'string') {
    clone['cloneUrl'] = redactToken(clone['cloneUrl']);
  }
  if (clone['url'] && typeof clone['url'] === 'string') {
    clone['url'] = redactToken(clone['url']);
  }
  if (clone['repository'] && typeof clone['repository'] === 'string') {
    clone['repository'] = clone['repository'];
  }
  return clone;
}

function redactToken(value: string): string {
  return value.replace(/x-access-token:[^@]+@/i, 'x-access-token:***@');
}

function normalizeAutomationError(error: unknown): AutomationError {
  if (error instanceof AutomationError) {
    return error;
  }
  if (error instanceof Error) {
    return new AutomationError(
      'unexpected-error',
      error.message || 'Unexpected error',
      {
        details: {
          name: error.name,
          stack: error.stack,
        },
      },
    );
  }
  return new AutomationError('unexpected-error', 'Unknown automation error', {
    details: {
      raw: error,
    },
  });
}

export default GitHubAutomationService;
