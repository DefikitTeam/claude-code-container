/**
 * Refactor Placeholder (Phase 3: Git Service)
 * --------------------------------------------------
 * Encapsulates git repository operations: init, status, diff detection.
 * Will isolate child_process interactions to simplify testing.
 */

import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export interface IGitService {
  runGit(
    cwd: string,
    args: string[],
    opts?: { timeoutMs?: number },
  ): Promise<{ stdout: string; stderr: string; code: number | null }>;
  ensureRepo(
    path: string,
    opts?: { defaultBranch?: string; cloneUrl?: string },
  ): Promise<void>;
  getStatus(path: string): Promise<string>;
  hasUncommittedChanges(path: string): Promise<boolean>;
  getCurrentBranch(path: string): Promise<string | null>;
  getRemoteUrl(path: string): Promise<string | undefined>;
  getLastCommitMessage(path: string): Promise<string | undefined>;
  getInfo(path: string): Promise<{
    currentBranch: string;
    hasUncommittedChanges: boolean;
    remoteUrl?: string;
    lastCommit?: string;
  } | null>;
  listChangedFiles(
    path: string,
    opts?: { staged?: boolean },
  ): Promise<string[]>;
  createBranch(path: string, branchName: string, from?: string): Promise<void>;
  checkoutBranch(path: string, branchName: string): Promise<void>;
  stageFiles(path: string, files: string[]): Promise<void>;
  commit(path: string, message: string): Promise<void>;
  push(path: string, remote?: string, branch?: string): Promise<void>;
  applyPatch(path: string, patch: string): Promise<void>;
}

export class GitService implements IGitService {
  // Allows dependency injection for run wrapper in future
  constructor(_deps?: {}) {}

  async runGit(
    cwd: string,
    args: string[],
    opts?: { timeoutMs?: number },
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    try {
      const res = await execFileAsync('git', args, {
        cwd,
        timeout: opts?.timeoutMs,
      });
      return {
        stdout: String(res.stdout || ''),
        stderr: String(res.stderr || ''),
        code: 0,
      };
    } catch (e: any) {
      // If git binary missing or other execution error
      if (e.code === 'ENOENT') {
        throw new Error('git-not-found');
      }
      // execFile throws on non-zero exit; capture stdout/stderr if present
      return {
        stdout: String(e.stdout || ''),
        stderr: String(e.stderr || ''),
        code: typeof e.code === 'number' ? e.code : null,
      };
    }
  }

  async ensureRepo(
    repoPath: string,
    opts?: { defaultBranch?: string; cloneUrl?: string },
  ): Promise<void> {
    try {
      const gitDir = path.join(repoPath, '.git');
      // If .git exists, assume repo exists
      await fs.access(gitDir);
      return;
    } catch (e) {
      // not a git repo; attempt to create or clone
    }

    // If directory doesn't exist, create
    try {
      await fs.mkdir(repoPath, { recursive: true });
    } catch (e) {
      // ignore mkdir errors and let git error if any
    }

    if (opts?.cloneUrl) {
      // Try clone into path (shallow clone)
      try {
        // If path not empty, cloning into existing dir requires it to be empty. Attempt clone into temp then move.
        const parent = path.dirname(repoPath);
        await fs.mkdir(parent, { recursive: true });
        const res = await this.runGit(parent, [
          'clone',
          '--depth',
          '1',
          opts.cloneUrl,
          repoPath,
        ]);
        if (res.code !== 0) {
          // fall through to init
        } else {
          return;
        }
      } catch (err) {
        // fallback to init below
      }
    }

    // Initialize a new repo and set default branch if provided
    await this.runGit(repoPath, ['init']);
    if (opts?.defaultBranch) {
      // create and switch to default branch
      await this.runGit(repoPath, ['checkout', '-b', opts.defaultBranch]);
    }
  }

  async getStatus(repoPath: string): Promise<string> {
    const res = await this.runGit(repoPath, ['status', '--porcelain']);
    return res.stdout;
  }

  async hasUncommittedChanges(repoPath: string): Promise<boolean> {
    try {
      const out = await this.getStatus(repoPath);
      return out.trim().length > 0;
    } catch (e) {
      return false;
    }
  }

  async getCurrentBranch(repoPath: string): Promise<string | null> {
    try {
      const res = await this.runGit(repoPath, ['branch', '--show-current']);
      const branch = res.stdout.trim();
      return branch || 'main';
    } catch (e) {
      return null;
    }
  }

  async getRemoteUrl(repoPath: string): Promise<string | undefined> {
    try {
      const res = await this.runGit(repoPath, ['remote', 'get-url', 'origin']);
      const u = res.stdout.trim();
      return u || undefined;
    } catch (e) {
      return undefined;
    }
  }

  async getLastCommitMessage(repoPath: string): Promise<string | undefined> {
    try {
      const res = await this.runGit(repoPath, ['log', '-1', '--pretty=%B']);
      const m = res.stdout.trim();
      return m || undefined;
    } catch (e) {
      return undefined;
    }
  }

  async getInfo(repoPath: string): Promise<{
    currentBranch: string;
    hasUncommittedChanges: boolean;
    remoteUrl?: string;
    lastCommit?: string;
  } | null> {
    try {
      const [branch, statusOut] = await Promise.all([
        this.getCurrentBranch(repoPath),
        this.getStatus(repoPath),
      ]);
      if (branch === null) return null;
      const hasUncommittedChanges = statusOut.trim().length > 0;
      const [remoteUrl, lastCommit] = await Promise.all([
        this.getRemoteUrl(repoPath),
        this.getLastCommitMessage(repoPath),
      ]);
      return {
        currentBranch: branch,
        hasUncommittedChanges,
        remoteUrl,
        lastCommit,
      };
    } catch (e) {
      return null;
    }
  }

  async listChangedFiles(
    repoPath: string,
    opts?: { staged?: boolean },
  ): Promise<string[]> {
    try {
      const args = opts?.staged
        ? ['diff', '--name-only', '--cached']
        : ['diff', '--name-only'];
      const res = await this.runGit(repoPath, args);
      return res.stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  async createBranch(
    repoPath: string,
    branchName: string,
    from?: string,
  ): Promise<void> {
    if (from) {
      await this.runGit(repoPath, ['checkout', '-b', branchName, from]);
    } else {
      await this.runGit(repoPath, ['checkout', '-b', branchName]);
    }
  }

  async checkoutBranch(repoPath: string, branchName: string): Promise<void> {
    await this.runGit(repoPath, ['checkout', branchName]);
  }

  async stageFiles(repoPath: string, files: string[]): Promise<void> {
    if (!files || files.length === 0) return;
    await this.runGit(repoPath, ['add', '--', ...files]);
  }

  async commit(repoPath: string, message: string): Promise<void> {
    // allow empty commit messages to be rejected by git
    await this.runGit(repoPath, ['commit', '-m', message]);
  }

  async push(
    repoPath: string,
    remote = 'origin',
    branch?: string,
  ): Promise<void> {
    const args = ['push', remote];
    if (branch) args.push(branch);
    await this.runGit(repoPath, args);
  }

  async applyPatch(repoPath: string, patch: string): Promise<void> {
    try {
      // write patch to temp file then apply
      const tmp = path.join(repoPath, `.acp_patch_${Date.now()}.diff`);
      await fs.writeFile(tmp, patch, { encoding: 'utf8' });
      await this.runGit(repoPath, ['apply', tmp]);
      // cleanup tmp
      try {
        await fs.unlink(tmp);
      } catch (e) {}
    } catch (e) {
      throw e;
    }
  }
}

export default GitService;
