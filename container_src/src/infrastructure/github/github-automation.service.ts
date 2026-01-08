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

  private async runGitChecked(
    repoPath: string,
    args: string[],
    errorCode: string,
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const result = await this.git.runGit(repoPath, args);
    if (result.code !== 0) {
      throw new AutomationError(errorCode, 'Git command failed', {
        details: {
          args,
          code: result.code,
          stderr: result.stderr,
        },
      });
    }
    return result;
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
      mode: normalizedMode === 'commit-only' ? 'commit-only' : 'github',
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
        mode: decision.mode,
      });

      // ONLY create issue if NOT in commit-only mode AND we don't have one
      if (decision.mode !== 'commit-only' && !issue) {
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
        
        // Skip PR and Issue comment if in commit-only mode
        if (decision.mode !== 'commit-only') {
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
          this.log(logs, 'automation.commitOnly', {
            message: 'Skipping PR creation (commit-only mode)',
            branch: prepared.branchName
          });
        }
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

    await this.runGitChecked(
      workspacePath,
      ['fetch', 'origin', baseBranch],
      'git-fetch-base-failed',
    );
    await this.runGitChecked(
      workspacePath,
      ['checkout', baseBranch],
      'git-checkout-base-failed',
    );
    await this.runGitChecked(
      workspacePath,
      ['pull', '--ff-only', 'origin', baseBranch],
      'git-pull-base-failed',
    );

    const branchName =
      context.branchNameOverride ||
      buildBranchName(
        this.branchPrefix,
        issue,
        context.sessionId,
        this.nowFn(),
      );

    // Fetch the target branch if it exists remotely so we can align local state.
    // Use explicit refspec so this works even when the repo was cloned with a single-branch fetch refspec.
    // (In that case, `git fetch origin <branch>` may not create refs/remotes/origin/<branch>.)
    await this.git.runGit(workspacePath, [
      'fetch',
      '--depth',
      '50',
      'origin',
      `+refs/heads/${branchName}:refs/remotes/origin/${branchName}`,
    ]);

    const remoteRefCheck = await this.git.runGit(workspacePath, [
      'rev-parse',
      '--verify',
      `refs/remotes/origin/${branchName}`,
    ]);
    const remoteBranchExists = remoteRefCheck.code === 0;

    if (remoteBranchExists) {
      this.log(logs, 'git.branchRemoteExists', { branch: branchName });
      await this.runGitChecked(
        workspacePath,
        ['checkout', '-B', branchName, `origin/${branchName}`],
        'git-checkout-remote-branch-failed',
      );
      // Keep local in sync with remote (rebase keeps history linear for commit-only mode).
      await this.runGitChecked(
        workspacePath,
        ['pull', '--rebase', 'origin', branchName],
        'git-pull-rebase-branch-failed',
      );
    } else {
      this.log(logs, 'git.branchRemoteMissing', { branch: branchName });
      await this.runGitChecked(
        workspacePath,
        ['checkout', '-B', branchName, baseBranch],
        'git-create-branch-failed',
      );
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

    await this.runGitChecked(
      prepared.path,
      ['config', 'user.name', identity.name],
      'git-config-user-name-failed',
    );
    await this.runGitChecked(
      prepared.path,
      ['config', 'user.email', identity.email],
      'git-config-user-email-failed',
    );

    await this.runGitChecked(
      prepared.path,
      ['add', '--all'],
      'git-add-failed',
    );

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
    await this.throwIfGitFailed(commitResult, 'git-commit-failed');

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
      if (pushResult.code !== 0) {
        const stderr = pushResult.stderr || '';
        const isNonFastForward =
          /non-fast-forward/i.test(stderr) ||
          /tip of your current branch is behind/i.test(stderr) ||
          /fetch first/i.test(stderr);

        if (isNonFastForward) {
          this.log(logs, 'git.pushRetry', {
            branch: prepared.branchName,
            reason: 'non-fast-forward',
          });
          await this.runGitChecked(
            prepared.path,
            ['pull', '--rebase', 'origin', prepared.branchName],
            'git-pull-rebase-before-retry-failed',
          );
          const retryResult = await this.git.runGit(prepared.path, [
            'push',
            '--set-upstream',
            'origin',
            prepared.branchName,
          ]);
          await this.throwIfGitFailed(retryResult, 'git-push-failed');
        } else {
          await this.throwIfGitFailed(pushResult, 'git-push-failed');
        }
      }

      // Verify remote actually received the commit (prevents false-positive success).
      const localHead = await this.runGitChecked(
        prepared.path,
        ['rev-parse', 'HEAD'],
        'git-rev-parse-head-failed',
      );
      const localSha = localHead.stdout.trim();

      if (authedRemote) {
        const remoteLine = await this.git.runGit(prepared.path, [
          'ls-remote',
          authedRemote,
          `refs/heads/${prepared.branchName}`,
        ]);
        await this.throwIfGitFailed(remoteLine, 'git-ls-remote-failed');
        const remoteSha = remoteLine.stdout.trim().split(/\s+/)[0];
        if (!remoteSha || remoteSha !== localSha) {
          throw new AutomationError(
            'git-push-verify-failed',
            'Push completed but remote branch did not match local HEAD',
            {
              details: {
                branch: prepared.branchName,
                localSha,
                remoteSha: remoteSha || null,
              },
            },
          );
        }
      }

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
    if (result.code !== 0) {
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
  // Extract meaningful title from prompt, skipping metadata lines
  const lines = prompt.trim().split(/\r?\n/);

  // Skip metadata lines (Session Mode, Working in, Context Files, etc.)
  const meaningfulLine = lines.find((line) => {
    const trimmed = line.trim();
    // Skip empty lines
    if (!trimmed) return false;
    // Skip common metadata prefixes
    if (trimmed.startsWith('Session Mode:')) return false;
    if (trimmed.startsWith('Working in:')) return false;
    if (trimmed.startsWith('Context Files:')) return false;
    if (trimmed.startsWith('Requesting Agent:')) return false;
    if (trimmed.startsWith('-')) return false; // Skip list items
    // This is likely the actual user request
    return true;
  });

  if (!meaningfulLine) {
    // Fallback: try to find first non-empty line
    const firstNonEmpty = lines.find((l) => l.trim().length > 0);
    return firstNonEmpty && firstNonEmpty.length > 120
      ? `${firstNonEmpty.slice(0, 117)}...`
      : firstNonEmpty || 'Automated change request';
  }

  return meaningfulLine.length > 120
    ? `${meaningfulLine.slice(0, 117)}...`
    : meaningfulLine;
}

function derivePullRequestTitle(
  issue: GitHubIssueReference,
  promptTitle?: string,
  summary?: string,
): string {
  // Try to create a concise, action-oriented title

  // 1. If we have a summary, extract the main action/change
  if (summary) {
    // Look for action patterns in summary
    const actionMatch = summary.match(
      /(?:I(?:'ve| have))?\s*(changed|updated|modified|added|removed|fixed|implemented|created|refactored|improved)\s+([^.]+)/i,
    );
    if (actionMatch) {
      const action =
        actionMatch[1].charAt(0).toUpperCase() + actionMatch[1].slice(1);
      const target = actionMatch[2].trim();
      const title = `${action} ${target}`;
      return title.length > 120 ? `${title.slice(0, 117)}...` : title;
    }

    // Fallback: use first meaningful sentence from summary
    const sentences = summary
      .split(/[.!?]+/)
      .filter((s) => s.trim().length > 10);
    if (sentences.length > 0) {
      const firstSentence = sentences[0].trim();
      // Remove "I'll help you" or similar phrases
      const cleaned = firstSentence
        .replace(/^(?:I(?:'ll| will))?\s*help\s+you\s+/i, '')
        .replace(/^(?:Let me|I will|I'll)\s+/i, '')
        .trim();

      if (cleaned.length > 0) {
        return cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned;
      }
    }
  }

  // 2. Use prompt title if available
  if (promptTitle) {
    return promptTitle.length > 120
      ? `${promptTitle.slice(0, 117)}...`
      : promptTitle;
  }

  // 3. Fallback to issue reference
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
  const withoutProtocol = sanitized
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
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
