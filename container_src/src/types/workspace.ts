/**
 * Workspace state and isolation management types
 * Handles workspace isolation for ACP sessions using Docker volumes or filesystem isolation
 */

// ===== Workspace Configuration =====

export interface WorkspaceConfig {
  rootPath: string;
  isolationMode: 'docker' | 'filesystem' | 'memory';
  maxWorkspaceSize: number; // bytes
  allowedFileTypes: string[]; // file extensions
  restrictedPaths: string[]; // paths that cannot be accessed
  gitIntegration: boolean;
  autoCleanup: boolean;
  cleanupDelay: number; // milliseconds
}

// ===== Workspace State =====

export interface WorkspaceState {
  sessionId: string;
  workspaceId: string;
  rootPath: string;
  isolationPath: string; // actual isolated directory path
  gitInfo?: {
    repository: string;
    branch: string;
    commit: string;
    hasUncommittedChanges: boolean;
    modifiedFiles: string[];
    untrackedFiles: string[];
  };
  fileSystem: {
    totalSize: number;
    fileCount: number;
    lastModified: number;
    accessPattern: Record<string, number>; // file -> access count
  };
  metadata: {
    createdAt: number;
    lastAccessedAt: number;
    permissions: WorkspacePermissions;
    tags: string[];
  };
}

// ===== Workspace Permissions =====

export interface WorkspacePermissions {
  canRead: boolean;
  canWrite: boolean;
  canExecute: boolean;
  canCreateFiles: boolean;
  canDeleteFiles: boolean;
  canAccessNetwork: boolean;
  canRunGitCommands: boolean;
  allowedOperations: WorkspaceOperation[];
}

export type WorkspaceOperation =
  | 'read_file'
  | 'write_file'
  | 'create_file'
  | 'delete_file'
  | 'list_directory'
  | 'git_status'
  | 'git_add'
  | 'git_commit'
  | 'git_push'
  | 'git_branch'
  | 'run_command'
  | 'install_dependencies'
  | 'build_project';

// ===== Workspace Manager Interface =====

export interface WorkspaceManager {
  createWorkspace(config: WorkspaceCreationConfig): Promise<WorkspaceState>;
  loadWorkspace(workspaceId: string): Promise<WorkspaceState | null>;
  deleteWorkspace(workspaceId: string): Promise<void>;
  listWorkspaces(): Promise<string[]>;

  // File operations
  readFile(workspaceId: string, filePath: string): Promise<string>;
  writeFile(workspaceId: string, filePath: string, content: string): Promise<void>;
  createFile(workspaceId: string, filePath: string, content: string): Promise<void>;
  deleteFile(workspaceId: string, filePath: string): Promise<void>;
  listFiles(workspaceId: string, directoryPath?: string): Promise<FileInfo[]>;

  // Git operations
  gitStatus(workspaceId: string): Promise<GitStatus>;
  gitAdd(workspaceId: string, files: string[]): Promise<void>;
  gitCommit(workspaceId: string, message: string): Promise<string>; // returns commit hash
  gitCreateBranch(workspaceId: string, branchName: string): Promise<void>;
  gitCheckout(workspaceId: string, branch: string): Promise<void>;

  // Workspace management
  cloneRepository(workspaceId: string, repoUrl: string, branch?: string): Promise<void>;
  syncWorkspace(workspaceId: string): Promise<void>;
  cleanupWorkspace(workspaceId: string): Promise<void>;

  // Monitoring
  getWorkspaceStats(workspaceId: string): Promise<WorkspaceStats>;
  validateWorkspace(workspaceId: string): Promise<WorkspaceValidationResult>;
}

// ===== Workspace Creation =====

export interface WorkspaceCreationConfig {
  sessionId: string;
  workspaceUri?: string; // file:// URI or git repository URL
  branch?: string;
  permissions: WorkspacePermissions;
  isolationMode: WorkspaceConfig['isolationMode'];
  metadata?: {
    tags?: string[];
    description?: string;
    [key: string]: unknown;
  };
}

// ===== File System Types =====

export interface FileInfo {
  path: string;
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  mimeType?: string;
  encoding?: string;
  lastModified: number;
  permissions: {
    readable: boolean;
    writable: boolean;
    executable: boolean;
  };
  gitStatus?: 'untracked' | 'modified' | 'added' | 'deleted' | 'renamed' | 'clean';
}

export interface GitStatus {
  branch: string;
  commit: string;
  hasUncommittedChanges: boolean;
  staged: FileInfo[];
  modified: FileInfo[];
  untracked: FileInfo[];
  deleted: FileInfo[];
}

// ===== Workspace Statistics =====

export interface WorkspaceStats {
  workspaceId: string;
  sessionId: string;
  uptime: number; // milliseconds
  totalFileOperations: number;
  totalGitOperations: number;
  diskUsage: {
    totalSize: number;
    usedSize: number;
    fileCount: number;
    directoryCount: number;
  };
  performance: {
    averageFileReadTime: number; // milliseconds
    averageFileWriteTime: number; // milliseconds
    averageGitOperationTime: number; // milliseconds
  };
  errors: {
    totalErrors: number;
    recentErrors: WorkspaceError[];
  };
}

export interface WorkspaceError {
  timestamp: number;
  operation: WorkspaceOperation;
  error: string;
  filePath?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

// ===== Workspace Validation =====

export interface WorkspaceValidationResult {
  isValid: boolean;
  issues: WorkspaceValidationIssue[];
  recommendations: string[];
  securityScore: number; // 0-100
  performanceScore: number; // 0-100
}

export interface WorkspaceValidationIssue {
  type: 'security' | 'performance' | 'corruption' | 'permission' | 'resource';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  affectedFiles?: string[];
  suggestedFix?: string;
}

// ===== Isolation Strategies =====

export interface DockerIsolationConfig {
  imageName: string;
  containerName: string;
  volumeMounts: Record<string, string>; // host_path -> container_path
  environmentVariables: Record<string, string>;
  networkMode: 'bridge' | 'host' | 'none';
  resourceLimits: {
    memory: string; // e.g., "512m"
    cpu: string; // e.g., "0.5"
    diskSpace: string; // e.g., "1g"
  };
}

export interface FilesystemIsolationConfig {
  basePath: string;
  useSymlinks: boolean;
  copyOnWrite: boolean;
  enforceQuota: boolean;
  quotaLimit: number; // bytes
}

// ===== Default Configurations =====

export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  rootPath: '/tmp/acp-workspaces',
  isolationMode: 'filesystem',
  maxWorkspaceSize: 1024 * 1024 * 1024, // 1GB
  allowedFileTypes: ['.ts', '.js', '.json', '.md', '.txt', '.yml', '.yaml', '.toml', '.lock'],
  restrictedPaths: ['/etc', '/var', '/sys', '/proc', '/root'],
  gitIntegration: true,
  autoCleanup: true,
  cleanupDelay: 30 * 60 * 1000, // 30 minutes
};

export const DEFAULT_WORKSPACE_PERMISSIONS: WorkspacePermissions = {
  canRead: true,
  canWrite: true,
  canExecute: false,
  canCreateFiles: true,
  canDeleteFiles: true,
  canAccessNetwork: false,
  canRunGitCommands: true,
  allowedOperations: [
    'read_file',
    'write_file',
    'create_file',
    'delete_file',
    'list_directory',
    'git_status',
    'git_add',
    'git_commit',
    'git_branch',
  ],
};

// ===== Utility Functions =====

export function createWorkspaceId(sessionId: string): string {
  return `workspace-${sessionId}-${Date.now()}`;
}

export function validateWorkspaceId(workspaceId: string): boolean {
  return /^workspace-[a-zA-Z0-9-]+-\d+$/.test(workspaceId);
}

export function sanitizeFilePath(path: string): string {
  // Remove dangerous path components
  return path
    .replace(/\.\./g, '') // Remove parent directory references
    .replace(/\/+/g, '/') // Normalize multiple slashes
    .replace(/^\/+/, '') // Remove leading slashes
    .trim();
}

export function isAllowedFileType(filename: string, allowedTypes: string[]): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  return allowedTypes.includes(ext);
}

export function calculateWorkspaceSize(files: FileInfo[]): number {
  return files.reduce((total, file) => total + (file.type === 'file' ? file.size : 0), 0);
}