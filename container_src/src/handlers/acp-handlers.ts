// ---------------------------------------------------------------------------
// acp-handlers.ts (Deprecated Shim)
// ---------------------------------------------------------------------------
// Legacy monolithic handler removed. This temporary shim re-exports the new
// modular handlers for backward compatibility. Migrate imports to the specific
// handler files; this shim will be removed in a future major version.
// ---------------------------------------------------------------------------

export * from './initialize-handler.js';
export * from './session-new-handler.js';
export * from './session-load-handler.js';
export * from './session-prompt-handler.js';
export * from './cancel-handler.js';

if (!(globalThis as any).__ACP_HANDLERS_SHIM_WARNED__) {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  // eslint-disable-next-line no-console
  console.warn(
    '[DEPRECATION] `acp-handlers.ts` is a shim. Import specific handlers directly.',
  );
  (globalThis as any).__ACP_HANDLERS_SHIM_WARNED__ = true; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export default undefined;
