/**
 * Refactor Placeholder (Phase 3: Workspace Service)
 * --------------------------------------------------
 * Manages ephemeral workspace creation, path derivation, and cleanup.
 * Will collaborate with GitService for repository initialization/state checks.
 * No implementation yet – only structural placeholder.
 */

// TODO(acp-refactor/phase-3): Import / define Workspace descriptor type.
export interface IWorkspaceService {
  prepare(opts: { sessionId: string; reuse?: boolean }): Promise<any>; // TODO: replace any with concrete Workspace object
  getPath(sessionId: string): string;
  cleanup(sessionId: string): Promise<void>;
}

export class WorkspaceService implements IWorkspaceService {
  // TODO(acp-refactor/phase-3): Accept gitService + config options
  constructor(_deps?: { gitService?: any; baseDir?: string }) {}
  prepare(_opts: { sessionId: string; reuse?: boolean }): Promise<any> {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    throw new Error(
      'WorkspaceService.prepare not implemented (refactor phase 3 placeholder)',
    );
  }
  getPath(_sessionId: string): string {
    throw new Error(
      'WorkspaceService.getPath not implemented (refactor phase 3 placeholder)',
    );
  }
  cleanup(_sessionId: string): Promise<void> {
    throw new Error(
      'WorkspaceService.cleanup not implemented (refactor phase 3 placeholder)',
    );
  }
}

export default WorkspaceService;
