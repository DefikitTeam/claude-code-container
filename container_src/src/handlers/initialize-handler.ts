/**
 * Refactor Placeholder (Phase 7: initialize handler)
 * --------------------------------------------------
 * Will handle ACP method: initialize (session/environment bootstrap).
 * Depends on future service layer (PromptProcessor not required here yet).
 */

// TODO(acp-refactor/phase-7): Define request/response types (import from acp-messages when narrowed).
export async function initializeHandler(_params: any): Promise<any> {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  throw new Error(
    'initializeHandler not implemented (refactor phase 7 placeholder)',
  );
}

export default initializeHandler;
