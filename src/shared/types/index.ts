/**
 * Shared types for Clean Architecture
 * Foundation types used across all layers
 */

// ============================================
// ENVIRONMENT
// ============================================

/**
 * Generic Durable Object Namespace type
 * For type-safe Durable Object bindings
 */
interface DurableObjectNamespace {
  newUniqueId(options?: any): DurableObjectId;
  idFromName(name: string): DurableObjectId;
  idFromString(id: string): DurableObjectId;
  get(id: DurableObjectId, options?: any): DurableObjectStub;
  getByName(name: string, options?: any): DurableObjectStub;
}

interface DurableObjectId {
  toString(): string;
  equals(other: DurableObjectId): boolean;
  readonly name?: string;
}

interface DurableObjectStub {
  fetch(request: Request, init?: RequestInit): Promise<Response>;
  readonly id: DurableObjectId;
  readonly name?: string;
}

export interface Env {
  // Durable Object bindings
  MY_CONTAINER: DurableObjectNamespace;
  GITHUB_APP_CONFIG: DurableObjectNamespace;
  USER_CONFIG: DurableObjectNamespace;
  ACP_SESSION: DurableObjectNamespace;

  // Environment variables
  ANTHROPIC_API_KEY?: string;
  GITHUB_APP_ID?: string;
  GITHUB_WEBHOOK_SECRET?: string;

  // Fixed GitHub App configuration (service provider controlled)
  FIXED_GITHUB_APP_ID?: string;
  FIXED_GITHUB_PRIVATE_KEY?: string;
  FIXED_GITHUB_WEBHOOK_SECRET?: string;

  // CORS configuration
  ALLOWED_ORIGINS?: string;
}

// ============================================
// GITHUB CONFIGURATION
// ============================================

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  installationId?: string;
  installationToken?: string;
  tokenExpiresAt?: number;
}

export interface FixedGitHubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
}

export interface StoredGitHubConfig {
  appId: string;
  encryptedPrivateKey: {
    encryptedData: Uint8Array;
    iv: Uint8Array;
  };
  encryptedWebhookSecret: {
    encryptedData: Uint8Array;
    iv: Uint8Array;
  };
  installationId?: string;
  encryptedInstallationToken?: {
    encryptedData: Uint8Array;
    iv: Uint8Array;
  } | null;
  tokenExpiresAt?: number;
  updatedAt: string;
}

// ============================================
// USER & INSTALLATION
// ============================================

export interface RegistrationSummary {
  userId: string;
  projectLabel?: string | null;
  created?: number;
  updated?: number;
  isActive?: boolean;
}

export interface InstallationDirectory {
  installationId: string;
  registrations: RegistrationSummary[];
  lastMigratedAt?: number;
}

export interface UserConfig {
  userId: string;
  installationId: string;
  anthropicApiKey: string;
  repositoryAccess: string[];
  created: number;
  updated: number;
  isActive: boolean;
  projectLabel?: string | null;
  existingRegistrations?: RegistrationSummary[];
}

export interface StoredUserConfig {
  userId: string;
  installationId: string;
  encryptedAnthropicApiKey: {
    encryptedData: Uint8Array;
    iv: Uint8Array;
  };
  repositoryAccess: string[];
  created: number;
  updated: number;
  isActive: boolean;
  projectLabel?: string | null;
}

export interface UserRegistrationRequest {
  installationId: string;
  anthropicApiKey: string;
  userId?: string;
  projectLabel?: string;
}

export interface UserRegistrationResponse {
  success: boolean;
  userId: string;
  installationId: string;
  existingRegistrations: RegistrationSummary[];
  projectLabel?: string | null;
  message?: string;
}

export interface UserDeletionResponse {
  success: boolean;
  removedUserId: string;
  installationId: string;
  remainingRegistrations: RegistrationSummary[];
  message?: string;
}

export interface UserInstallationToken {
  installationId: string;
  token: string;
  expiresAt: number;
  userId: string;
}

export interface GitHubInstallation {
  id: number;
  account: {
    login: string;
    type: string;
  };
}

// ============================================
// GITHUB WEBHOOKS
// ============================================

export interface GitHubIssuePayload {
  action: string;
  issue: {
    id: number;
    number: number;
    title: string;
    body: string;
    state: string;
    html_url: string;
    user: {
      login: string;
    };
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    clone_url: string;
    default_branch: string;
    owner: {
      login: string;
    };
  };
  installation?: {
    id: number;
  };
}

// ============================================
// CONTAINER PROCESSING
// ============================================

export interface ContainerRequest {
  type: 'process_issue';
  payload: GitHubIssuePayload;
  config: GitHubAppConfig;
}

export interface ContainerResponse {
  success: boolean;
  message: string;
  pullRequestUrl?: string;
  error?: string;
  logs?: string[];
}

export interface ProcessingResult {
  success: boolean;
  message: string;
  pullRequestUrl?: string;
  error?: string;
}

// ============================================
// PROMPT PROCESSING
// ============================================

export interface PromptRequest {
  prompt: string;
  repository?: string;
  branch?: string;
  title?: string;
}

export interface PromptProcessingResult {
  success: boolean;
  message?: string;
  issueId?: number;
  issueNumber?: number;
  issueUrl?: string;
  pullRequestUrl?: string;
  error?: string;
  repository?: string;
  branch?: string;
  githubAutomation?: GitHubAutomationResult;
}

// ============================================
// GITHUB AUTOMATION
// ============================================

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

// ============================================
// ACP (Agent Client Protocol)
// ============================================

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

// ============================================
// SESSION AUDIT
// ============================================

export interface SessionPromptAuditRecord {
  type: 'session_prompt_result';
  timestamp: string;
  sessionId: string;
  stopReason: 'completed' | 'cancelled' | 'error';
  usage?: ACPSessionPromptUsage;
  githubAutomation?: GitHubAutomationAudit;
  githubAutomationVersion?: string;
}
