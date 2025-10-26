export type AutomationStatus = 'success' | 'skipped' | 'error';

export interface GitHubIssueReference {
  id: number;
  number: number;
  url: string;
  title: string;
}

export interface GitHubPullRequestReference {
  number: number;
  url: string;
  branch: string;
  draft?: boolean;
}

export interface GitHubCommitReference {
  sha: string;
  message: string;
}

export interface AutomationDiagnostics {
  durationMs: number;
  attempts: number;
  logs: string[];
  errorCode?: string;
  startTimestamp?: string;
  endTimestamp?: string;
}

export interface AutomationErrorDetail {
  code: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface GitHubAutomationResult {
  status: AutomationStatus;
  issue?: GitHubIssueReference;
  pullRequest?: GitHubPullRequestReference;
  branch?: string;
  commit?: GitHubCommitReference;
  skippedReason?: string;
  error?: AutomationErrorDetail;
  diagnostics: AutomationDiagnostics;
  metadata?: Record<string, unknown>;
}

export interface AutomationIntentSignals {
  mode?: string;
  disabled?: boolean;
  repositoryBlocked?: boolean;
  reason?: string;
  explicit?: boolean;
  force?: boolean;
  agentContext?: Record<string, unknown>;
}

export interface AutomationDecision {
  run: boolean;
  mode: 'github' | 'none';
  reason?: string;
  explicit?: boolean;
}

export interface RepositoryTarget {
  owner: string;
  name: string;
  defaultBranch: string;
  cloneUrl?: string;
}

export interface GitIdentity {
  name: string;
  email: string;
}

export interface GitHubAutomationContext {
  sessionId: string;
  workspacePath: string;
  repository: RepositoryTarget;
  auth: {
    installationToken: string;
  };
  prompt: {
    title?: string;
    body: string;
  };
  summaryMarkdown?: string;
  intent?: AutomationIntentSignals;
  existingIssue?: GitHubIssueReference;
  labels?: string[];
  branchNameOverride?: string;
  baseBranchOverride?: string;
  git?: Partial<GitIdentity>;
  metadata?: Record<string, unknown>;
  dryRun?: boolean;
  allowEmptyCommit?: boolean;
}

export interface IGitHubAutomationService {
  detectIntent(signals?: AutomationIntentSignals): AutomationDecision;
  execute(context: GitHubAutomationContext): Promise<GitHubAutomationResult>;
}
