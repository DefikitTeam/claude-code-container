// Types for the GitHub Issue Processing System

export interface Env {
  // Durable Object bindings (includes container classes)
  MY_CONTAINER: DurableObjectNamespace;
  GITHUB_APP_CONFIG: DurableObjectNamespace;
  USER_CONFIG: DurableObjectNamespace;

  // Environment variables
  ANTHROPIC_API_KEY?: string;
  GITHUB_APP_ID?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  
  // Fixed GitHub App configuration (service provider controlled)
  FIXED_GITHUB_APP_ID?: string;
  FIXED_GITHUB_PRIVATE_KEY?: string;
  FIXED_GITHUB_WEBHOOK_SECRET?: string;
}

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  installationId?: string;
  installationToken?: string;
  tokenExpiresAt?: number;
}

// Multi-tenant user configuration
export interface UserConfig {
  userId: string;
  installationId: string;
  anthropicApiKey: string;
  repositoryAccess: string[]; // List of repo full_names the user has access to
  created: number;
  updated: number;
  isActive: boolean;
}

// Fixed GitHub App configuration (service provider controlled)
export interface FixedGitHubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
}

// Per-user installation token cache
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

export interface ProcessingResult {
  success: boolean;
  message: string;
  pullRequestUrl?: string;
  error?: string;
}

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

export interface PromptRequest {
  prompt: string;
  repository?: string; // owner/repo format, optional if user has only one installation
  branch?: string; // target branch, defaults to repository default branch
  title?: string; // issue title, generated from prompt if not provided
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

// Encrypted user configuration storage
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
}

// User registration request
export interface UserRegistrationRequest {
  installationId: string;
  anthropicApiKey: string;
  userId?: string; // Optional, can be generated if not provided
}

// --- ACP (Agent Client Protocol) types ---
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