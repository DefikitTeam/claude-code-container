/**
 * Refactor Placeholder (Phase 4: Auth Service)
 * --------------------------------------------------
 * Ensures appropriate auth configuration (env-only vs file based) for downstream tools.
 * Will handle creation/validation of temporary credential files if required.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export interface IAuthService {
  ensureAuth(opts: { apiKey?: string; sessionId: string }): Promise<void>;
  cleanup(opts: { sessionId: string }): Promise<void>;
  diagnostics(): Promise<Record<string, any>>;
}

type ManagedFiles = {
  authFile: string;
  legacyFile: string;
  backupAuthFile?: string | null;
  wroteAuth?: boolean;
  wroteLegacy?: boolean;
};

export class AuthService implements IAuthService {
  private managed = new Map<string, ManagedFiles>();

  constructor(_deps?: { env?: NodeJS.ProcessEnv }) {
    // future: accept injectable env/fs for testing
  }

  private getPaths() {
    const home = os.homedir();
    const configDir = path.join(home, '.config', 'claude-code');
    const authFile = path.join(configDir, 'auth.json');
    const legacyFile = path.join(home, '.claude.json');
    return { home, configDir, authFile, legacyFile };
  }

  /**
   * Ensure auth files or env-only mode is configured for the request.
   * - If CLAUDE_CODE_ENV_AUTH_ONLY is truthy, prefer env-only and do not write files.
   * - Will back up any pre-existing auth.json before writing and restore on cleanup.
   */
  async ensureAuth(opts: { apiKey?: string; sessionId: string }): Promise<void> {
    const { apiKey, sessionId } = opts;
    if (!apiKey && !process.env.ANTHROPIC_API_KEY) return; // nothing to do

    const envOnly =
      process.env.CLAUDE_CODE_ENV_AUTH_ONLY === '1' ||
      process.env.CLAUDE_CODE_ENV_AUTH_ONLY === 'true';

    const { configDir, authFile, legacyFile } = this.getPaths();

    const state: ManagedFiles = {
      authFile,
      legacyFile,
      backupAuthFile: null,
      wroteAuth: false,
      wroteLegacy: false,
    };

    // If env-only is requested, set environment and record no files written
    if (envOnly) {
      if (apiKey) process.env.ANTHROPIC_API_KEY = apiKey;
      this.managed.set(sessionId, state);
      return;
    }

    // Ensure config dir exists
    try {
      await fs.mkdir(configDir, { recursive: true });
    } catch (e) {
      // best-effort: if cannot create, fall back to env-only by setting var
      if (apiKey) process.env.ANTHROPIC_API_KEY = apiKey;
      this.managed.set(sessionId, state);
      return;
    }

    // Back up existing auth file if present
    try {
      await fs.access(authFile);
      const backupPath = authFile + '.bak-' + Date.now();
      await fs.rename(authFile, backupPath);
      state.backupAuthFile = backupPath;
    } catch (e) {
      // no existing auth file
    }

    // Write new auth file atomically
    const authPayload = JSON.stringify({ key: apiKey || process.env.ANTHROPIC_API_KEY });
    const tmpAuth = authFile + '.tmp-' + Date.now();
    try {
      await fs.writeFile(tmpAuth, authPayload, { mode: 0o600 });
      await fs.rename(tmpAuth, authFile);
      state.wroteAuth = true;
    } catch (e) {
      // On failure, restore backup if any
      try {
        if (state.backupAuthFile) {
          await fs.rename(state.backupAuthFile, authFile);
        }
      } catch (_) {}
      // Fallback to env var
      if (apiKey) process.env.ANTHROPIC_API_KEY = apiKey;
      this.managed.set(sessionId, state);
      return;
    }

    // Write legacy file (lightweight), tolerate failures
    try {
      const legacyPayload = JSON.stringify({ key: apiKey || process.env.ANTHROPIC_API_KEY });
      const tmpLegacy = legacyFile + '.tmp-' + Date.now();
      await fs.writeFile(tmpLegacy, legacyPayload, { mode: 0o600 });
      await fs.rename(tmpLegacy, legacyFile);
      state.wroteLegacy = true;
    } catch (e) {
      // ignore
    }

    // Save managed state
    this.managed.set(sessionId, state);
  }

  /**
   * Cleanup files written for the session and restore backups if present.
   * Safe to call multiple times.
   */
  async cleanup(opts: { sessionId: string }): Promise<void> {
    const { sessionId } = opts;
    const state = this.managed.get(sessionId);
    if (!state) return;

    // Remove auth file if we wrote it
    try {
      if (state.wroteAuth) {
        await fs.unlink(state.authFile).catch(() => {});
      }
    } catch (e) {
      // ignore
    }

    // Restore backup if present
    try {
      if (state.backupAuthFile) {
        await fs.rename(state.backupAuthFile, state.authFile).catch(() => {});
      }
    } catch (e) {
      // ignore
    }

    // Remove legacy if we wrote it
    try {
      if (state.wroteLegacy) {
        await fs.unlink(state.legacyFile).catch(() => {});
      }
    } catch (e) {
      // ignore
    }

    // Remove any env var we set? We avoid deleting ANTHROPIC_API_KEY if it was pre-existing.
    // For safety we do not unset ANTHROPIC_API_KEY here.

    this.managed.delete(sessionId);
  }

  async diagnostics(): Promise<Record<string, any>> {
    const { authFile, legacyFile } = this.getPaths();
    const diag: Record<string, any> = {
      authFile,
      legacyFile,
      authFileExists: false,
      legacyFileExists: false,
    };
    try {
      await fs.access(authFile);
      diag.authFileExists = true;
    } catch (_) {}
    try {
      await fs.access(legacyFile);
      diag.legacyFileExists = true;
    } catch (_) {}
    return diag;
  }
}

export default AuthService;
