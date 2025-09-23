/**
 * Refactor Placeholder (Phase 3: Git Service)
 * --------------------------------------------------
 * Encapsulates git repository operations: init, status, diff detection.
 * Will isolate child_process interactions to simplify testing.
 */

export interface IGitService {
  ensureRepo(path: string, opts?: { defaultBranch?: string }): Promise<void>;
  getStatus(path: string): Promise<any>; // TODO: replace any with structured status type
  hasUncommittedChanges(path: string): Promise<boolean>;
}

export class GitService implements IGitService {
  // TODO(acp-refactor/phase-3): Accept shell runner abstraction + logger
  constructor(_deps?: {
    run?: (
      cmd: string,
      cwd?: string,
    ) => Promise<{ stdout: string; stderr: string }>;
  }) {}
  async ensureRepo(
    _path: string,
    _opts?: { defaultBranch?: string },
  ): Promise<void> {
    throw new Error(
      'GitService.ensureRepo not implemented (refactor phase 3 placeholder)',
    );
  }
  async getStatus(_path: string): Promise<any> {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    throw new Error(
      'GitService.getStatus not implemented (refactor phase 3 placeholder)',
    );
  }
  async hasUncommittedChanges(_path: string): Promise<boolean> {
    throw new Error(
      'GitService.hasUncommittedChanges not implemented (refactor phase 3 placeholder)',
    );
  }
}

export default GitService;
