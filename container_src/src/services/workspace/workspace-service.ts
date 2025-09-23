/**
 * Workspace Service (Phase 3 refactor)
 * - Responsible for deriving workspace paths (user-provided or ephemeral),
 *   gathering lightweight workspace metadata (git info), and cleaning up
 *   ephemeral workspaces.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import type { WorkspaceInfo } from '../../types/acp-messages.js';

const execFileAsync = promisify(execFile);

export interface WorkspaceDescriptor {
  sessionId: string;
  path: string;
  isEphemeral: boolean;
  createdAt: number;
  gitInfo?: {
    currentBranch?: string;
    hasUncommittedChanges?: boolean;
    remoteUrl?: string;
    lastCommit?: string;
  } | null;
}

export interface IWorkspaceService {
  prepare(opts: {
    sessionId: string;
    reuse?: boolean;
    workspaceUri?: string;
    sessionOptions?: { enableGitOps?: boolean };
  }): Promise<WorkspaceDescriptor>;
  getPath(sessionId: string): string | undefined;
  cleanup(sessionId: string): Promise<void>;
}

function getDefaultSessionBase(): string {
  // Honor env override for session workspace base
  return (
    process.env.ACP_WORKSPACE_BASE_DIR || path.join(os.tmpdir(), 'acp-workspaces')
  );
}

function getEphemeralDir(sessionId: string): string {
  const base = getDefaultSessionBase();
  return path.join(base, `acp-workspace-${sessionId}`);
}

async function getGitInfo(workspacePath: string): Promise<
  | {
      currentBranch: string;
      hasUncommittedChanges: boolean;
      remoteUrl?: string;
      lastCommit?: string;
    }
  | null
> {
  try {
    const gitDir = path.join(workspacePath, '.git');
    await fs.access(gitDir);

    const branchResult = await execFileAsync('git', ['branch', '--show-current'], {
      cwd: workspacePath,
    });
    const currentBranch = branchResult.stdout.trim() || 'main';

    const statusResult = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: workspacePath,
    });
    const hasUncommittedChanges = statusResult.stdout.trim().length > 0;

    let remoteUrl: string | undefined;
    try {
      const remoteResult = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
        cwd: workspacePath,
      });
      remoteUrl = remoteResult.stdout.trim() || undefined;
    } catch (e) {
      remoteUrl = undefined;
    }

    let lastCommit: string | undefined;
    try {
      const lastResult = await execFileAsync('git', ['log', '-1', '--pretty=%B'], {
        cwd: workspacePath,
      });
      lastCommit = lastResult.stdout.trim() || undefined;
    } catch (e) {
      lastCommit = undefined;
    }

    return { currentBranch, hasUncommittedChanges, remoteUrl, lastCommit };
  } catch (e) {
    return null;
  }
}

async function getBasicGitInfo(workspacePath: string): Promise<
  | { currentBranch: string; hasUncommittedChanges: boolean }
  | null
> {
  try {
    const gitDir = path.join(workspacePath, '.git');
    await fs.access(gitDir);

    const branchResult = await execFileAsync('git', ['branch', '--show-current'], {
      cwd: workspacePath,
    });
    const currentBranch = branchResult.stdout.trim() || 'main';

    const statusResult = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: workspacePath,
    });
    const hasUncommittedChanges = statusResult.stdout.trim().length > 0;

    return { currentBranch, hasUncommittedChanges };
  } catch (e) {
    return null;
  }
}

async function prepareEphemeralWorkspace(sessionId: string): Promise<string> {
  const dir = getEphemeralDir(sessionId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export class WorkspaceService implements IWorkspaceService {
  private map = new Map<string, WorkspaceDescriptor>();
  private baseDir: string;

  constructor(opts?: { baseDir?: string }) {
    this.baseDir = opts?.baseDir ?? getDefaultSessionBase();
  }

  /**
   * Prepare a workspace for a session.
   * - If `workspaceUri` provided and accessible, use it.
   * - Otherwise create an ephemeral workspace under the configured base.
   */
  async prepare(opts: {
    sessionId: string;
    reuse?: boolean;
    workspaceUri?: string;
    sessionOptions?: { enableGitOps?: boolean };
  }): Promise<WorkspaceDescriptor> {
    const { sessionId, reuse = true, workspaceUri, sessionOptions } = opts;

    if (reuse && this.map.has(sessionId)) {
      return this.map.get(sessionId)!;
    }

    let resolvedPath: string;
    let isEphemeral = false;

    if (workspaceUri) {
      try {
        resolvedPath = new URL(workspaceUri).pathname;
      } catch (e) {
        // Fallback to using as local path
        resolvedPath = workspaceUri;
      }
      try {
        await fs.access(resolvedPath, fs.constants.R_OK | fs.constants.W_OK);
      } catch (e) {
        // If workspaceUri is not accessible, fallback to ephemeral
        resolvedPath = await prepareEphemeralWorkspace(sessionId);
        isEphemeral = true;
      }
    } else {
      resolvedPath = await prepareEphemeralWorkspace(sessionId);
      isEphemeral = true;
    }

    const desc: WorkspaceDescriptor = {
      sessionId,
      path: resolvedPath,
      isEphemeral,
      createdAt: Date.now(),
      gitInfo: null,
    };

    // Gather git info if requested
    if (sessionOptions?.enableGitOps) {
      desc.gitInfo = await getGitInfo(resolvedPath);
    } else {
      const basic = await getBasicGitInfo(resolvedPath);
      desc.gitInfo = basic ? { currentBranch: basic.currentBranch, hasUncommittedChanges: basic.hasUncommittedChanges } : null;
    }

    this.map.set(sessionId, desc);
    return desc;
  }

  getPath(sessionId: string): string | undefined {
    return this.map.get(sessionId)?.path;
  }

  async cleanup(sessionId: string): Promise<void> {
    const desc = this.map.get(sessionId);
    if (!desc) return;
    if (desc.isEphemeral) {
      try {
        // prefer rm with recursive; ignore errors
        // Node 14+ supports fs.rm
        // use fs.rm if available else fs.rmdir
        // fs.promises.rm exists in modern Node; use it via fs.rm
        // but to keep compatibility we call fs.rm if present on fs
        // Here using fs.stat to ensure path exists
        await fs.access(desc.path);
        // remove recursively and force
        // @ts-ignore - using rm on fs.promises
        if ((fs as any).rm) {
          // some environments provide rm
          await (fs as any).rm(desc.path, { recursive: true, force: true });
        } else {
          await fs.rmdir(desc.path, { recursive: true });
        }
      } catch (e) {
        // ignore cleanup errors
      }
    }
    this.map.delete(sessionId);
  }
}

export default WorkspaceService;
