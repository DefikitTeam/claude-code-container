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

if (!(globalThis as unknown as { __ACP_HANDLERS_SHIM_WARNED__: boolean }).__ACP_HANDLERS_SHIM_WARNED__) {
   
   
  console.warn(
    '[DEPRECATION] `acp-handlers.ts` is a shim. Import specific handlers directly.',
  );
  (globalThis as unknown as { __ACP_HANDLERS_SHIM_WARNED__: boolean }).__ACP_HANDLERS_SHIM_WARNED__ = true;  
}

export default undefined;
