/**
 * Refactor Placeholder (Phase 4: Auth Service)
 * --------------------------------------------------
 * Ensures appropriate auth configuration (env-only vs file based) for downstream tools.
 * Will handle creation/validation of temporary credential files if required.
 */

export interface IAuthService {
  ensureAuth(opts: { workspacePath: string; sessionId: string }): Promise<void>;
  cleanup(opts: { workspacePath: string; sessionId: string }): Promise<void>;
}

export class AuthService implements IAuthService {
  // TODO(acp-refactor/phase-4): Accept env access + file system adapter
  constructor(_deps?: { env?: NodeJS.ProcessEnv }) {}
  async ensureAuth(_opts: {
    workspacePath: string;
    sessionId: string;
  }): Promise<void> {
    throw new Error(
      'AuthService.ensureAuth not implemented (refactor phase 4 placeholder)',
    );
  }
  async cleanup(_opts: {
    workspacePath: string;
    sessionId: string;
  }): Promise<void> {
    throw new Error(
      'AuthService.cleanup not implemented (refactor phase 4 placeholder)',
    );
  }
}

export default AuthService;
