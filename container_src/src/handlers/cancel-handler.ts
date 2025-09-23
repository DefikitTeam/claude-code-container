import { acpState } from './acp-state';
import type { CancelRequest, CancelResponse } from '../types/acp-messages.js';
import { claudeClient } from '../services/bootstrap';

// Fallback local cancel if ClaudeClient not yet wired as singleton
async function cancelInFlight(sessionId: string, operationId?: string): Promise<boolean> {
  let cancelled = false;
  try {
    if (operationId) {
      await claudeClient().cancelOperation(sessionId, operationId);
      cancelled = true;
    } else {
      await claudeClient().cancel(sessionId);
      cancelled = true;
    }
  } catch {}
  // also abort controllers in acpState (legacy tracking)
  const aborted = acpState.cancelOperation(operationId ? `${sessionId}:${operationId}` : sessionId);
  return cancelled || aborted;
}

export async function cancelHandler(
  params: CancelRequest['params'],
): Promise<CancelResponse['result']> {
  if (!acpState.isInitialized()) {
    throw Object.assign(new Error('Agent not initialized'), { code: -32000 });
  }
  if (!params || !params.sessionId) {
    throw Object.assign(new Error('Invalid params: sessionId'), { code: -32602 });
  }
  const { sessionId, operationId } = params as any; // tolerant to absence of operationId
  const session = acpState.getSession(sessionId);
  if (!session) {
    throw Object.assign(new Error(`Session not found: ${sessionId}`), { code: -32001 });
  }
  const cancelled = await cancelInFlight(sessionId, operationId);
  session.state = 'paused';
  session.lastActiveAt = Date.now();
  acpState.setSession(sessionId, session);
  return { cancelled };
}

export default cancelHandler;
