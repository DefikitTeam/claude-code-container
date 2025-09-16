/**
 * T018 - Workspace isolation implementation
 * Implements proper workspace isolation for ACP sessions using filesystem isolation
 */

import { promises as fs } from 'fs';
import { join, resolve, dirname } from 'path';
import { spawn } from 'child_process';
import {
  WorkspaceManager,
  WorkspaceState,
  WorkspaceCreationConfig,
  WorkspaceConfig,
  WorkspacePermissions,
  FileInfo,
  GitStatus,
  WorkspaceStats,
  WorkspaceValidationResult,
  WorkspaceError,
  WorkspaceOperation,
  DEFAULT_WORKSPACE_CONFIG,
  DEFAULT_WORKSPACE_PERMISSIONS,
  createWorkspaceId,
  validateWorkspaceId,
  sanitizeFilePath,
  isAllowedFileType,
  calculateWorkspaceSize,
} from './types/workspace.js';

/**
 * FilesystemWorkspaceManager - Implements workspace isolation using filesystem boundaries
 */
export class FilesystemWorkspaceManager implements WorkspaceManager {
  private config: WorkspaceConfig;
  private workspaces: Map<string, WorkspaceState> = new Map();
  private cleanupTimers: Map<string, NodeJS.Timeout> = new Map();
  private stats: Map<string, WorkspaceStats> = new Map();

  constructor(config: Partial<WorkspaceConfig> = {}) {
    this.config = { ...DEFAULT_WORKSPACE_CONFIG, ...config };
    this.ensureBaseDirectory();
  }

  // ===== Core Workspace Management =====

  async createWorkspace(config: WorkspaceCreationConfig): Promise<WorkspaceState> {
    const workspaceId = createWorkspaceId(config.sessionId);
    const isolationPath = join(this.config.rootPath, workspaceId);

    // Create isolated directory
    await fs.mkdir(isolationPath, { recursive: true });

    const workspace: WorkspaceState = {
      sessionId: config.sessionId,
      workspaceId,
      rootPath: config.workspaceUri || isolationPath,
      isolationPath,
      fileSystem: {
        totalSize: 0,
        fileCount: 0,
        lastModified: Date.now(),
        accessPattern: {},
      },
      metadata: {
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        permissions: config.permissions,
        tags: config.metadata?.tags || [],
      },
    };

    // Clone repository if specified
    if (config.workspaceUri && config.workspaceUri.startsWith('http')) {
      try {
        await this.cloneRepository(workspaceId, config.workspaceUri, config.branch);
        workspace.gitInfo = await this.getGitInfo(isolationPath);
      } catch (error) {
        console.warn(`Failed to clone repository: ${error}`);
      }
    } else if (config.workspaceUri && config.workspaceUri.startsWith('file://')) {
      // Copy local directory
      const sourcePath = config.workspaceUri.replace('file://', '');
      await this.copyDirectory(sourcePath, isolationPath);
    }

    // Initialize workspace stats
    await this.updateWorkspaceStats(workspaceId);

    // Store workspace
    this.workspaces.set(workspaceId, workspace);

    // Schedule cleanup if enabled
    if (this.config.autoCleanup) {
      this.scheduleCleanup(workspaceId);
    }

    return workspace;
  }

  async loadWorkspace(workspaceId: string): Promise<WorkspaceState | null> {
    if (!validateWorkspaceId(workspaceId)) {
      return null;
    }

    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      // Try to restore from filesystem
      const isolationPath = join(this.config.rootPath, workspaceId);
      if (await this.pathExists(isolationPath)) {
        // Restore minimal workspace state
        const restored: WorkspaceState = {
          sessionId: workspaceId.split('-')[1] || 'unknown',
          workspaceId,
          rootPath: isolationPath,
          isolationPath,
          fileSystem: {
            totalSize: 0,
            fileCount: 0,
            lastModified: Date.now(),
            accessPattern: {},
          },
          metadata: {
            createdAt: Date.now(),
            lastAccessedAt: Date.now(),
            permissions: DEFAULT_WORKSPACE_PERMISSIONS,
            tags: [],
          },
        };
        this.workspaces.set(workspaceId, restored);
        return restored;
      }
      return null;
    }

    // Update access time
    workspace.metadata.lastAccessedAt = Date.now();
    return workspace;
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const workspace = await this.loadWorkspace(workspaceId);
    if (!workspace) {
      return;
    }

    // Cancel cleanup timer
    const timer = this.cleanupTimers.get(workspaceId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(workspaceId);
    }

    // Remove filesystem
    try {
      await fs.rm(workspace.isolationPath, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to remove workspace directory: ${error}`);
    }

    // Remove from memory
    this.workspaces.delete(workspaceId);
    this.stats.delete(workspaceId);
  }

  async listWorkspaces(): Promise<string[]> {
    return Array.from(this.workspaces.keys());
  }

  // ===== File Operations =====

  async readFile(workspaceId: string, filePath: string): Promise<string> {
    const workspace = await this.loadWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    await this.checkPermission(workspace, 'read_file');
    const safePath = this.resolveSafePath(workspace.isolationPath, filePath);

    try {
      const content = await fs.readFile(safePath, 'utf8');
      await this.recordFileAccess(workspaceId, filePath, 'read_file');
      return content;
    } catch (error) {
      await this.recordError(workspaceId, 'read_file', String(error), filePath);
      throw error;
    }
  }

  async writeFile(workspaceId: string, filePath: string, content: string): Promise<void> {
    const workspace = await this.loadWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    await this.checkPermission(workspace, 'write_file');
    const safePath = this.resolveSafePath(workspace.isolationPath, filePath);

    // Ensure directory exists
    await fs.mkdir(dirname(safePath), { recursive: true });

    try {
      await fs.writeFile(safePath, content, 'utf8');
      await this.recordFileAccess(workspaceId, filePath, 'write_file');
      await this.updateWorkspaceStats(workspaceId);
    } catch (error) {
      await this.recordError(workspaceId, 'write_file', String(error), filePath);
      throw error;
    }
  }

  async createFile(workspaceId: string, filePath: string, content: string): Promise<void> {
    const workspace = await this.loadWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    await this.checkPermission(workspace, 'create_file');
    const safePath = this.resolveSafePath(workspace.isolationPath, filePath);

    // Check if file already exists
    if (await this.pathExists(safePath)) {
      throw new Error(`File already exists: ${filePath}`);
    }

    return this.writeFile(workspaceId, filePath, content);
  }

  async deleteFile(workspaceId: string, filePath: string): Promise<void> {
    const workspace = await this.loadWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    await this.checkPermission(workspace, 'delete_file');
    const safePath = this.resolveSafePath(workspace.isolationPath, filePath);

    try {
      await fs.unlink(safePath);
      await this.recordFileAccess(workspaceId, filePath, 'delete_file');
      await this.updateWorkspaceStats(workspaceId);
    } catch (error) {
      await this.recordError(workspaceId, 'delete_file', String(error), filePath);
      throw error;
    }
  }

  async listFiles(workspaceId: string, directoryPath: string = ''): Promise<FileInfo[]> {
    const workspace = await this.loadWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    await this.checkPermission(workspace, 'list_directory');
    const safePath = this.resolveSafePath(workspace.isolationPath, directoryPath);

    try {
      const entries = await fs.readdir(safePath, { withFileTypes: true });
      const files: FileInfo[] = [];

      for (const entry of entries) {
        const fullPath = join(safePath, entry.name);
        const stat = await fs.stat(fullPath);
        const relativePath = join(directoryPath, entry.name);

        files.push({
          path: relativePath,
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
          size: stat.size,
          lastModified: stat.mtime.getTime(),
          permissions: {
            readable: true,
            writable: workspace.metadata.permissions.canWrite,
            executable: workspace.metadata.permissions.canExecute,
          },
        });
      }

      await this.recordFileAccess(workspaceId, directoryPath || '/', 'list_directory');
      return files;
    } catch (error) {
      await this.recordError(workspaceId, 'list_directory', String(error), directoryPath);
      throw error;
    }
  }

  // ===== Git Operations =====

  async gitStatus(workspaceId: string): Promise<GitStatus> {
    const workspace = await this.loadWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    await this.checkPermission(workspace, 'git_status');

    try {
      const result = await this.executeGitCommand(workspace.isolationPath, ['status', '--porcelain', '--branch']);
      const lines = result.split('\n').filter(line => line.trim());

      const gitInfo = await this.getGitInfo(workspace.isolationPath);

      const staged: FileInfo[] = [];
      const modified: FileInfo[] = [];
      const untracked: FileInfo[] = [];
      const deleted: FileInfo[] = [];

      for (const line of lines) {
        if (line.startsWith('##')) continue; // Branch info

        const status = line.substring(0, 2);
        const filePath = line.substring(3);

        const fileInfo = await this.createFileInfo(workspace.isolationPath, filePath);

        if (status[0] === 'A' || status[0] === 'M' || status[0] === 'D') {
          staged.push({ ...fileInfo, gitStatus: status[0] === 'A' ? 'added' : status[0] === 'M' ? 'modified' : 'deleted' });
        }
        if (status[1] === 'M') {
          modified.push({ ...fileInfo, gitStatus: 'modified' });
        }
        if (status === '??') {
          untracked.push({ ...fileInfo, gitStatus: 'untracked' });
        }
        if (status[1] === 'D') {
          deleted.push({ ...fileInfo, gitStatus: 'deleted' });
        }
      }

      return {
        branch: gitInfo?.branch || 'main',
        commit: gitInfo?.commit || '',
        hasUncommittedChanges: staged.length > 0 || modified.length > 0 || untracked.length > 0 || deleted.length > 0,
        staged,
        modified,
        untracked,
        deleted,
      };
    } catch (error) {
      await this.recordError(workspaceId, 'git_status', String(error));
      throw error;
    }
  }

  async gitAdd(workspaceId: string, files: string[]): Promise<void> {
    const workspace = await this.loadWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    await this.checkPermission(workspace, 'git_add');

    try {
      await this.executeGitCommand(workspace.isolationPath, ['add', ...files]);
      await this.recordFileAccess(workspaceId, files.join(','), 'git_add');
    } catch (error) {
      await this.recordError(workspaceId, 'git_add', String(error));
      throw error;
    }
  }

  async gitCommit(workspaceId: string, message: string): Promise<string> {
    const workspace = await this.loadWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    await this.checkPermission(workspace, 'git_commit');

    try {
      await this.executeGitCommand(workspace.isolationPath, ['commit', '-m', message]);
      const result = await this.executeGitCommand(workspace.isolationPath, ['rev-parse', 'HEAD']);
      const commitHash = result.trim();

      await this.recordFileAccess(workspaceId, message, 'git_commit');
      return commitHash;
    } catch (error) {
      await this.recordError(workspaceId, 'git_commit', String(error));
      throw error;
    }
  }

  async gitCreateBranch(workspaceId: string, branchName: string): Promise<void> {
    const workspace = await this.loadWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    await this.checkPermission(workspace, 'git_branch');

    try {
      await this.executeGitCommand(workspace.isolationPath, ['checkout', '-b', branchName]);
      await this.recordFileAccess(workspaceId, branchName, 'git_branch');
    } catch (error) {
      await this.recordError(workspaceId, 'git_branch', String(error));
      throw error;
    }
  }

  async gitCheckout(workspaceId: string, branch: string): Promise<void> {
    const workspace = await this.loadWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    await this.checkPermission(workspace, 'git_branch');

    try {
      await this.executeGitCommand(workspace.isolationPath, ['checkout', branch]);
      await this.recordFileAccess(workspaceId, branch, 'git_branch');
    } catch (error) {
      await this.recordError(workspaceId, 'git_branch', String(error));
      throw error;
    }
  }

  // ===== Repository Management =====

  async cloneRepository(workspaceId: string, repoUrl: string, branch?: string): Promise<void> {
    const workspace = await this.loadWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    try {
      const args = ['clone'];
      if (branch) {
        args.push('-b', branch);
      }
      args.push(repoUrl, workspace.isolationPath);

      await this.executeCommand('git', args, dirname(workspace.isolationPath));
      await this.updateWorkspaceStats(workspaceId);

      // Update git info
      workspace.gitInfo = await this.getGitInfo(workspace.isolationPath);
    } catch (error) {
      await this.recordError(workspaceId, 'git_status', String(error));
      throw error;
    }
  }

  async syncWorkspace(workspaceId: string): Promise<void> {
    const workspace = await this.loadWorkspace(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    if (workspace.gitInfo) {
      try {
        await this.executeGitCommand(workspace.isolationPath, ['fetch', 'origin']);
        await this.executeGitCommand(workspace.isolationPath, ['merge', 'origin/' + workspace.gitInfo.branch]);
        workspace.gitInfo = await this.getGitInfo(workspace.isolationPath);
      } catch (error) {
        console.warn(`Failed to sync workspace: ${error}`);
      }
    }

    await this.updateWorkspaceStats(workspaceId);
  }

  async cleanupWorkspace(workspaceId: string): Promise<void> {
    // This is a soft cleanup - removes temporary files but keeps workspace
    const workspace = await this.loadWorkspace(workspaceId);
    if (!workspace) {
      return;
    }

    try {
      // Clean git temporary files
      const gitTmpPath = join(workspace.isolationPath, '.git', 'tmp');
      if (await this.pathExists(gitTmpPath)) {
        await fs.rm(gitTmpPath, { recursive: true, force: true });
      }

      // Clean build artifacts (common patterns)
      const cleanupPatterns = ['node_modules', 'dist', 'build', '.tmp', 'temp'];
      for (const pattern of cleanupPatterns) {
        const targetPath = join(workspace.isolationPath, pattern);
        if (await this.pathExists(targetPath)) {
          await fs.rm(targetPath, { recursive: true, force: true });
        }
      }

      await this.updateWorkspaceStats(workspaceId);
    } catch (error) {
      console.warn(`Failed to cleanup workspace: ${error}`);
    }
  }

  // ===== Monitoring =====

  async getWorkspaceStats(workspaceId: string): Promise<WorkspaceStats> {
    return this.stats.get(workspaceId) || this.createEmptyStats(workspaceId);
  }

  async validateWorkspace(workspaceId: string): Promise<WorkspaceValidationResult> {
    const workspace = await this.loadWorkspace(workspaceId);
    if (!workspace) {
      return {
        isValid: false,
        issues: [{ type: 'corruption', severity: 'critical', message: 'Workspace not found' }],
        recommendations: ['Recreate workspace'],
        securityScore: 0,
        performanceScore: 0,
      };
    }

    const issues: any[] = [];
    let securityScore = 100;
    let performanceScore = 100;

    // Check filesystem integrity
    if (!await this.pathExists(workspace.isolationPath)) {
      issues.push({
        type: 'corruption',
        severity: 'critical',
        message: 'Workspace directory does not exist',
        suggestedFix: 'Recreate workspace',
      });
      securityScore -= 50;
      performanceScore -= 50;
    }

    // Check permissions
    if (!workspace.metadata.permissions.canRead) {
      issues.push({
        type: 'permission',
        severity: 'high',
        message: 'Workspace has no read permissions',
        suggestedFix: 'Grant read permissions',
      });
      securityScore -= 20;
    }

    // Check size limits
    const stats = await this.getWorkspaceStats(workspaceId);
    if (stats.diskUsage.totalSize > this.config.maxWorkspaceSize) {
      issues.push({
        type: 'resource',
        severity: 'medium',
        message: 'Workspace exceeds size limit',
        suggestedFix: 'Clean up large files or increase limit',
      });
      performanceScore -= 30;
    }

    return {
      isValid: issues.length === 0 || !issues.some(i => i.severity === 'critical'),
      issues,
      recommendations: issues.map(i => i.suggestedFix).filter(Boolean),
      securityScore,
      performanceScore,
    };
  }

  // ===== Private Helper Methods =====

  private async ensureBaseDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.config.rootPath, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to create workspace base directory: ${error}`);
    }
  }

  private resolveSafePath(basePath: string, userPath: string): string {
    const sanitized = sanitizeFilePath(userPath);
    const resolved = resolve(basePath, sanitized);

    // Ensure path is within workspace bounds
    if (!resolved.startsWith(resolve(basePath))) {
      throw new Error(`Path outside workspace bounds: ${userPath}`);
    }

    return resolved;
  }

  private async checkPermission(workspace: WorkspaceState, operation: WorkspaceOperation): Promise<void> {
    if (!workspace.metadata.permissions.allowedOperations.includes(operation)) {
      throw new Error(`Operation not allowed: ${operation}`);
    }
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async copyDirectory(source: string, destination: string): Promise<void> {
    await fs.mkdir(destination, { recursive: true });
    const entries = await fs.readdir(source, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = join(source, entry.name);
      const destPath = join(destination, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  private async executeCommand(command: string, args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args, { cwd });
      let stdout = '';
      let stderr = '';

      process.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Command failed with code ${code}`));
        }
      });

      process.on('error', reject);
    });
  }

  private async executeGitCommand(cwd: string, args: string[]): Promise<string> {
    return this.executeCommand('git', args, cwd);
  }

  private async getGitInfo(path: string) {
    try {
      const branch = (await this.executeGitCommand(path, ['branch', '--show-current'])).trim();
      const commit = (await this.executeGitCommand(path, ['rev-parse', 'HEAD'])).trim();
      const status = await this.executeGitCommand(path, ['status', '--porcelain']);

      const modifiedFiles: string[] = [];
      const untrackedFiles: string[] = [];

      status.split('\n').forEach(line => {
        if (line.trim()) {
          const filePath = line.substring(3);
          if (line.startsWith(' M') || line.startsWith('M ')) {
            modifiedFiles.push(filePath);
          } else if (line.startsWith('??')) {
            untrackedFiles.push(filePath);
          }
        }
      });

      return {
        repository: path,
        branch,
        commit,
        hasUncommittedChanges: modifiedFiles.length > 0 || untrackedFiles.length > 0,
        modifiedFiles,
        untrackedFiles,
      };
    } catch (error) {
      return undefined;
    }
  }

  private async createFileInfo(basePath: string, relativePath: string): Promise<FileInfo> {
    const fullPath = join(basePath, relativePath);
    const stat = await fs.stat(fullPath);
    const name = relativePath.split('/').pop() || relativePath;

    return {
      path: relativePath,
      name,
      type: stat.isDirectory() ? 'directory' : 'file',
      size: stat.size,
      lastModified: stat.mtime.getTime(),
      permissions: {
        readable: true,
        writable: true,
        executable: stat.mode & 0o111 ? true : false,
      },
    };
  }

  private async recordFileAccess(workspaceId: string, filePath: string, operation: WorkspaceOperation): Promise<void> {
    const workspace = this.workspaces.get(workspaceId);
    if (workspace) {
      workspace.fileSystem.accessPattern[filePath] = (workspace.fileSystem.accessPattern[filePath] || 0) + 1;
      workspace.metadata.lastAccessedAt = Date.now();
    }

    // Update stats
    const stats = this.stats.get(workspaceId);
    if (stats) {
      if (operation.includes('file')) {
        stats.totalFileOperations++;
      } else if (operation.includes('git')) {
        stats.totalGitOperations++;
      }
    }
  }

  private async recordError(workspaceId: string, operation: WorkspaceOperation, error: string, filePath?: string): Promise<void> {
    const stats = this.stats.get(workspaceId);
    if (stats) {
      stats.errors.totalErrors++;
      stats.errors.recentErrors.unshift({
        timestamp: Date.now(),
        operation,
        error,
        filePath,
        severity: 'medium',
      });

      // Keep only last 10 errors
      if (stats.errors.recentErrors.length > 10) {
        stats.errors.recentErrors = stats.errors.recentErrors.slice(0, 10);
      }
    }
  }

  private createEmptyStats(workspaceId: string): WorkspaceStats {
    const workspace = this.workspaces.get(workspaceId);
    const stats: WorkspaceStats = {
      workspaceId,
      sessionId: workspace?.sessionId || 'unknown',
      uptime: workspace ? Date.now() - workspace.metadata.createdAt : 0,
      totalFileOperations: 0,
      totalGitOperations: 0,
      diskUsage: {
        totalSize: 0,
        usedSize: 0,
        fileCount: 0,
        directoryCount: 0,
      },
      performance: {
        averageFileReadTime: 0,
        averageFileWriteTime: 0,
        averageGitOperationTime: 0,
      },
      errors: {
        totalErrors: 0,
        recentErrors: [],
      },
    };

    this.stats.set(workspaceId, stats);
    return stats;
  }

  private async updateWorkspaceStats(workspaceId: string): Promise<void> {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return;

    try {
      const files = await this.listFiles(workspaceId);
      const totalSize = calculateWorkspaceSize(files);
      const fileCount = files.filter(f => f.type === 'file').length;
      const directoryCount = files.filter(f => f.type === 'directory').length;

      workspace.fileSystem = {
        ...workspace.fileSystem,
        totalSize,
        fileCount,
        lastModified: Date.now(),
      };

      const stats = this.stats.get(workspaceId) || this.createEmptyStats(workspaceId);
      stats.diskUsage = {
        totalSize,
        usedSize: totalSize,
        fileCount,
        directoryCount,
      };
      stats.uptime = Date.now() - workspace.metadata.createdAt;

      this.stats.set(workspaceId, stats);
    } catch (error) {
      console.warn(`Failed to update workspace stats: ${error}`);
    }
  }

  private scheduleCleanup(workspaceId: string): void {
    const existingTimer = this.cleanupTimers.get(workspaceId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      console.log(`Auto-cleaning workspace: ${workspaceId}`);
      try {
        await this.deleteWorkspace(workspaceId);
      } catch (error) {
        console.warn(`Failed to auto-cleanup workspace: ${error}`);
      }
    }, this.config.cleanupDelay);

    this.cleanupTimers.set(workspaceId, timer);
  }
}

// Export singleton instance
export const workspaceManager = new FilesystemWorkspaceManager();