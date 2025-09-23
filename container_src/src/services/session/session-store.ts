/**
 * Refactor Placeholder (Phase 2: Session Store)
 * --------------------------------------------------
 * This file is introduced as part of the ACP modularization (see ACP_REFACTOR_PLAN.md).
 * DO NOT implement logic yet. Will encapsulate session persistence (load/save/list/exists)
 * and hide filesystem layout. Will also become the place to add JSON schema validation in a later step.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ACPSession } from '../../types/acp-session.js'; // path relative to this file


// TODO(acp-refactor/phase-2): Define concrete session data shapes (import from existing types once extracted).
export interface ISessionStore {
  load(sessionId: string): Promise<ACPSession | undefined>;
  save(session: ACPSession): Promise<void>; // id derived from session.sessionId
  delete(sessionId: string): Promise<void>;
  list(): Promise<string[]>;
  exists(sessionId: string): Promise<boolean>;
}

function getSessionStorageDir(): string {
  return (
    process.env.ACP_SESSION_STORAGE_DIR ||
    path.join(process.cwd(), '.acp-sessions')
  );
}

/**
 * Temporary no-op implementation. All methods throw so accidental usage is surfaced early.
 */
export class SessionStore implements ISessionStore {
  // TODO(acp-refactor/phase-2): Accept constructor options (base path, fs adapter, logger)
  constructor(private opts?: { basePath?: string }) {}

  private sessionFilePath(sessionId: string): string {
    const base = this.opts?.basePath ?? getSessionStorageDir();
    return path.join(base, `${sessionId}.json`);
  }

  async load(sessionId: string): Promise<ACPSession | undefined> {
    const file = this.sessionFilePath(sessionId);
    try {
      const data = await fs.readFile(file, { encoding: 'utf8' });
      const session: ACPSession = JSON.parse(data);
      return session;
    } catch (e: any) {
      if (e.code === 'ENOENT') return undefined;
      // propagate other IO errors
      throw e;
    }
  }
  async save(session: ACPSession): Promise<void> {
    const sessionId = session.sessionId;
    const file = this.sessionFilePath(sessionId);
    const dir = path.dirname(file);
    try {
      await fs.mkdir(dir, { recursive: true });
      const sessionFile = path.join(dir, `${sessionId}.json`);
      const sessionData = JSON.stringify(session, null, 2);

      await fs.writeFile(sessionFile, sessionData, 'utf-8');
    } catch (e: any) {
      // propagate IO errors
      throw e;
    }
  }

  async list(): Promise<string[]> {
    const dir = this.opts?.basePath ?? getSessionStorageDir();
    try {
      const entries = await fs.readdir(dir);
      return entries
        .filter((n) => n.endsWith('.json'))
        .map((n) => n.replace(/\.json$/, ''));
    } catch (e: any) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }
  async exists(sessionId: string): Promise<boolean> {
    const file = this.sessionFilePath(sessionId);
    try {
      await fs.access(file);
      return true;
    } catch (e: any) {
      if (e.code === 'ENOENT') return false;
      throw e;
    }
  }
  
  async delete(sessionId: string): Promise<void> {
    const file = this.sessionFilePath(sessionId);
    try {
      await fs.unlink(file);
    } catch (e: any) {
      if (e.code === 'ENOENT') return;
      throw e;
    }
  }
}

export default SessionStore;
