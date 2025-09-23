/**
 * Refactor Placeholder (Phase 2: Session Store)
 * --------------------------------------------------
 * This file is introduced as part of the ACP modularization (see ACP_REFACTOR_PLAN.md).
 * DO NOT implement logic yet. Will encapsulate session persistence (load/save/list/exists)
 * and hide filesystem layout. Will also become the place to add JSON schema validation in a later step.
 */

// TODO(acp-refactor/phase-2): Define concrete session data shapes (import from existing types once extracted).
export interface ISessionStore {
  // Load a session by id; returns undefined if not found (no exception for missing).
  load(sessionId: string): Promise<any | undefined>; // TODO: replace any with Session type
  // Persist (create or update) a session.
  save(sessionId: string, data: any): Promise<void>; // TODO: replace any with Session type
  // List available session ids (may apply filtering later).
  list(): Promise<string[]>;
  // Quick existence check (avoids full load when only checking presence).
  exists(sessionId: string): Promise<boolean>;
}

/**
 * Temporary no-op implementation. All methods throw so accidental usage is surfaced early.
 */
export class SessionStore implements ISessionStore {
  // TODO(acp-refactor/phase-2): Accept constructor options (base path, fs adapter, logger)
  constructor(_opts?: { basePath?: string }) {}

  async load(_sessionId: string): Promise<any | undefined> {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    throw new Error(
      'SessionStore.load not implemented (refactor phase 2 placeholder)',
    );
  }
  async save(_sessionId: string, _data: any): Promise<void> {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    throw new Error(
      'SessionStore.save not implemented (refactor phase 2 placeholder)',
    );
  }
  async list(): Promise<string[]> {
    throw new Error(
      'SessionStore.list not implemented (refactor phase 2 placeholder)',
    );
  }
  async exists(_sessionId: string): Promise<boolean> {
    throw new Error(
      'SessionStore.exists not implemented (refactor phase 2 placeholder)',
    );
  }
}

export default SessionStore;
