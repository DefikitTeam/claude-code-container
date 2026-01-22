/**
 * Common utility types
 */

/**
 * Generic paginated response
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  timestamp: number;
  requestId?: string;
}

/**
 * Generic request/response metadata
 */
export interface RequestMetadata {
  requestId: string;
  timestamp: number;
  userId?: string;
  installationId?: string;
  userAgent?: string;
}

/**
 * Result type for operations that might fail
 */
export type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };

/**
 * Async result helper
 */
export async function ok<T>(value: T): Promise<Result<T>> {
  return { success: true, value };
}

export async function err<E>(error: E): Promise<Result<never, E>> {
  return { success: false, error };
}

/**
 * ACP (Agent Communication Protocol) Types
 */

export interface ACPMessage {
  id: string;
  type: string;
  sender: string;
  target?: string;
  timestamp: number;
  payload?: any;
  signature?: string;
}

export interface ACPSession {
  sessionId: string;
  agentId: string;
  capabilities: string[];
  createdAt: number;
  lastSeenAt: number;
}

/**
 * GitHub Automation Types
 */

export type GitHubAutomationStatus = 'success' | 'skipped' | 'error';

export interface GitHubAutomationIssueReference {
  id: number;
  number: number;
  url: string;
  title: string;
}

export interface GitHubAutomationPullRequestReference {
  number: number;
  url: string;
  branch: string;
  draft?: boolean;
}

export interface GitHubAutomationCommitReference {
  sha: string;
  message: string;
}

export interface GitHubAutomationErrorDetail {
  code: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface GitHubAutomationDiagnostics {
  durationMs: number;
  attempts?: number;
  logs?: string[];
  errorCode?: string;
  startTimestamp?: string;
  endTimestamp?: string;
}

export interface GitHubAutomationResult {
  status: GitHubAutomationStatus;
  issue?: GitHubAutomationIssueReference;
  pullRequest?: GitHubAutomationPullRequestReference;
  branch?: string;
  commit?: GitHubAutomationCommitReference;
  skippedReason?: string;
  error?: GitHubAutomationErrorDetail;
  diagnostics: GitHubAutomationDiagnostics;
  metadata?: Record<string, unknown>;
}

export interface ACPSessionPromptUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ACPSessionPromptWorkspaceMeta {
  sessionId: string;
  path: string;
  isEphemeral: boolean;
  git?: {
    currentBranch?: string;
    hasUncommittedChanges?: boolean;
    remoteUrl?: string;
    lastCommit?: string;
  };
}

export interface ACPSessionPromptMeta {
  durationMs?: number;
  preDiagnostics?: Record<string, unknown>;
  workspace?: ACPSessionPromptWorkspaceMeta;
  githubAutomationVersion?: string;
  orchestration?: {
    planId?: string;
    stepId?: string;
    requestingAgent?: string;
    subTask?: string;
    expectedOutput?: string;
    plan?: Record<string, unknown>;
  };
}

export interface ACPSessionPromptResult {
  stopReason: 'completed' | 'cancelled' | 'error';
  usage: ACPSessionPromptUsage;
  summary?: string;
  githubOperations?: Record<string, unknown>;
  githubAutomation?: GitHubAutomationResult;
  errorCode?: string;
  diagnostics?: Record<string, unknown>;
  meta?: ACPSessionPromptMeta;
}

export interface GitHubAutomationAuditDiagnostics {
  durationMs?: number;
  attempts?: number;
  errorCode?: string;
  logCount?: number;
}

export interface GitHubAutomationAudit {
  status: GitHubAutomationStatus;
  branch?: string;
  issue?: Pick<GitHubAutomationIssueReference, 'number' | 'url' | 'title'>;
  pullRequest?: Pick<
    GitHubAutomationPullRequestReference,
    'number' | 'url' | 'branch' | 'draft'
  >;
  commitSha?: string;
  commitMessage?: string;
  skippedReason?: string;
  error?: Pick<GitHubAutomationErrorDetail, 'code' | 'message' | 'retryable'>;
  diagnostics?: GitHubAutomationAuditDiagnostics;
}

export interface SessionPromptAuditRecord {
  type: 'session_prompt_result';
  timestamp: string;
  sessionId: string;
  stopReason: 'completed' | 'cancelled' | 'error';
  usage?: ACPSessionPromptUsage;
  githubAutomation?: GitHubAutomationAudit;
  githubAutomationVersion?: string;
}
