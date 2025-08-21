// Types for the GitHub Issue Processing System

export interface Env {
  // Durable Object bindings (includes container classes)
  MY_CONTAINER: DurableObjectNamespace;
  GITHUB_APP_CONFIG: DurableObjectNamespace;

  // Environment variables
  ANTHROPIC_API_KEY?: string;
  GITHUB_APP_ID?: string;
  GITHUB_WEBHOOK_SECRET?: string;
}

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  installationId?: string;
  installationToken?: string;
  tokenExpiresAt?: number;
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