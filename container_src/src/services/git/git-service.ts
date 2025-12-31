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
    console.log(
      `[GitService] runGit called: cwd="${cwd}", args=${JSON.stringify(args)}`,
    );
    try {
      const res = await execFileAsync('git', args, {
        cwd,
        timeout: opts?.timeoutMs,
      });
      console.log(
        `[GitService] git success: stdout=${res.stdout?.toString().substring(0, 100)}`,
      );
      return {
        stdout: String(res.stdout || ''),
        stderr: String(res.stderr || ''),
        code: 0,
      };
    } catch (e: any) {
      console.error(`[GitService] git error:`, {
        code: e.code,
        message: e.message,
        cwd,
        args,
        syscall: e.syscall,
        path: e.path,
      });
      // If git binary missing or other execution error
      if (e.code === 'ENOENT') {
        // Check if it's git binary or cwd that's missing
        const errorDetail =
          e.path === 'git'
            ? 'git binary not found in PATH'
            : `directory or file not found: ${e.path || cwd}`;
        console.error(`[GitService] ENOENT details: ${errorDetail}`);
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
    const isPersistent = Boolean(process.env.DAYTONA_WORKSPACE_ID);
    try {
      const gitDir = path.join(repoPath, '.git');
      // If .git exists, assume repo exists
      await fs.access(gitDir);
      if (isPersistent) {
        await this.syncPersistentWorkspace(repoPath, opts);
      }
      await this.ensureGitUserConfigured(repoPath);
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
          await this.ensureGitUserConfigured(repoPath);
          return;
        }
      } catch (err) {
        // fallback to init below
      }
    }

    // Initialize a new repo and set default branch if provided
    await this.runGit(repoPath, ['init']);
    if (opts?.defaultBranch) {
      await this.runGit(repoPath, ['checkout', '-b', opts.defaultBranch]);
    }

    // CRITICAL: Add origin remote if cloneUrl provided (for push to work later)
    if (opts?.cloneUrl) {
      console.log(`[GitService] Adding origin remote: ${opts.cloneUrl}`);
      await this.runGit(repoPath, ['remote', 'add', 'origin', opts.cloneUrl]);
    }

    try {
      await this.ensureGitUserConfigured(repoPath);
    } catch (e) {
      console.warn(
        '[GitService] Failed to configure git user during ensureRepo:',
        e,
      );
    }
  }

  private async syncPersistentWorkspace(
    repoPath: string,
    opts?: { defaultBranch?: string; cloneUrl?: string },
  ): Promise<void> {
    const branch = opts?.defaultBranch ?? 'main';
    const cloneSlug = opts?.cloneUrl
      ? this.getRepoSlug(opts.cloneUrl)
      : undefined;
    const remoteUrl = await this.getRemoteUrl(repoPath);
    const remoteSlug = remoteUrl ? this.getRepoSlug(remoteUrl) : undefined;

    if (cloneSlug && remoteSlug && cloneSlug !== remoteSlug) {
      console.warn(
        `[GitService] Remote URL mismatch for persistent workspace ${repoPath}: expected ${cloneSlug}, got ${remoteSlug}`,
      );
    }

    try {
      await this.fetchAndPull(repoPath, branch);
    } catch (e) {
      console.error(
        `[GitService] Failed to update persistent workspace ${repoPath}:`,
        e,
      );
      await this.resetWorkspace(repoPath);
      try {
        await this.fetchAndPull(repoPath, branch);
      } catch (pullError) {
        console.error(
          `[GitService] Recovery pull failed for ${repoPath}:`,
          pullError,
        );
      }
    }
  }

  private getRepoSlug(url: string): string | undefined {
    const cleaned = url.replace(/https:\/\/[^@]+@/, 'https://');
    const match = cleaned.match(
      /github\.com[:\/](?<slug>[^\/]+\/[^\/]+)(?:\.git)?$/i,
    );
    return match?.groups?.slug.toLowerCase();
  }

  private async fetchAndPull(repoPath: string, branch: string): Promise<void> {
    const fetchRes = await this.runGit(repoPath, ['fetch', 'origin', branch]);
    if (fetchRes.code !== 0) {
      throw new Error(`git fetch failed (${fetchRes.stderr.trim()})`);
    }

    try {
      await this.checkoutBranch(repoPath, branch);
    } catch (e) {
      await this.runGit(repoPath, ['checkout', '-B', branch]);
    }

    const pullRes = await this.runGit(repoPath, [
      'pull',
      '--ff-only',
      'origin',
      branch,
    ]);
    if (pullRes.code !== 0) {
      throw new Error(`git pull failed (${pullRes.stderr.trim()})`);
    }
  }

  private async resetWorkspace(repoPath: string): Promise<void> {
    await this.runGit(repoPath, ['reset', '--hard']);
    await this.runGit(repoPath, ['clean', '-fd']);
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
      // Create branch from base without checking out base first (preserves uncommitted changes)
      await this.runGit(repoPath, ['branch', branchName, from]);
      await this.runGit(repoPath, ['checkout', branchName]);
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
    // Ensure git user is configured before committing
    await this.ensureGitUserConfigured(repoPath);

    // allow empty commit messages to be rejected by git
    await this.runGit(repoPath, ['commit', '-m', message]);
  }

  async ensureGitUserConfigured(repoPath: string): Promise<void> {
    // Check if user.name is configured
    const nameRes = await this.runGit(repoPath, ['config', 'user.name']);
    if (nameRes.code !== 0) {
      // Not configured, set default
      await this.runGit(repoPath, ['config', 'user.name', 'Claude Code Bot']);
      console.error('[GitService] Set git user.name to "Claude Code Bot"');
    }

    // Check if user.email is configured
    const emailRes = await this.runGit(repoPath, ['config', 'user.email']);
    if (emailRes.code !== 0) {
      // Not configured, set default
      await this.runGit(repoPath, [
        'config',
        'user.email',
        'noreply@anthropic.com',
      ]);
      console.error(
        '[GitService] Set git user.email to "noreply@anthropic.com"',
      );
    }
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
