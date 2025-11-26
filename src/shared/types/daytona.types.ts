export type SandboxStatus = 'creating' | 'running' | 'deleting' | 'deleted' | 'error';

export interface SandboxMetadata {
  userId: string;
  installationId?: string;
  issueId?: string | number;
  repository?: string;
  taskId?: string;
  [key: string]: string | number | undefined;
}

export interface SandboxState {
  sandboxId: string | null;
  status: SandboxStatus;
  devServerUrl: string | null;
  createdAt: number;
  lastAccessedAt: number;
}

export interface SandboxConfig {
  language?: 'python' | 'typescript' | 'go';
  timeout?: number;
  envVars: Record<string, string>;
  metadata: SandboxMetadata;
  cwd?: string;
}

export interface SandboxInfo {
  sandboxId: string;
  status: 'running' | 'deleted' | 'error';
}
