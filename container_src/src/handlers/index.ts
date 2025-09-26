/**
 * Refactor Placeholder (Phase 7: handlers index)
 * --------------------------------------------------
 * This file will aggregate the individual handler functions and expose a mapping
 * from ACP method name -> handler implementation. For now each handler simply
 * throws (placeholders) so we keep this isolated and do NOT modify existing
 * monolithic `acp-handlers.ts` until migration begins.
 *
 * Migration Plan:
 *  1. Implement each handler here using new services (future phases).
 *  2. Update existing dispatcher to import from this index (or replace it).
 *  3. Remove legacy logic from `acp-handlers.ts` once parity confirmed.
 */

import { initializeHandler } from './initialize-handler.js';
import { sessionNewHandler } from './session-new-handler.js';
import { sessionPromptHandler } from './session-prompt-handler.js';
import { sessionLoadHandler } from './session-load-handler.js';
import { cancelHandler } from './cancel-handler.js';

// TODO(acp-refactor/phase-7): Define strong typing for handler signatures.
export const handlers = {
  initialize: initializeHandler,
  'session/new': sessionNewHandler,
  'session/prompt': sessionPromptHandler,
  'session/load': sessionLoadHandler,
  cancel: cancelHandler,
};

export type HandlerMap = typeof handlers;

export default handlers;
