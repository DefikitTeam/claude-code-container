import { acpState } from './acp-state.js';
import type { SessionLoadRequest, SessionLoadResponse } from '../types/acp-messages.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ACPSession } from '../types/acp-session.js';
import { RequestContext } from '../services/stdio-jsonrpc.js';

function getSessionStorageDir(): string {
  return process.env.ACP_SESSION_STORAGE_DIR || path.join(process.cwd(), '.acp-sessions');
}

async function loadSessionFromPersistentStorage(sessionId: string): Promise<ACPSession | null> {
  try {
    const dir = getSessionStorageDir();
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${sessionId}.json`);
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch { return null; }
}

export async function sessionLoadHandler(
params: SessionLoadRequest['params'], requestContext: RequestContext,
): Promise<SessionLoadResponse['result']> {
  if (!acpState.isInitialized()) {
    throw Object.assign(new Error('Agent not initialized'), { code: -32000 });
  }
  if (!params || !params.sessionId) {
    throw Object.assign(new Error('Invalid params: sessionId'), { code: -32602 });
  }
  const { sessionId, includeHistory = false } = params;
  let session = acpState.getSession(sessionId);
  if (!session) {
    const persisted = await loadSessionFromPersistentStorage(sessionId);
    if (persisted) {
      session = persisted;
      acpState.setSession(sessionId, persisted);
    }
  }
  if (!session) {
    throw Object.assign(new Error(`Session not found: ${sessionId}`), { code: -32001 });
  }
  session.lastActiveAt = Date.now();
  acpState.setSession(sessionId, session);
  const sessionInfo: SessionLoadResponse['result']['sessionInfo'] = {
    sessionId: session.sessionId,
    state: session.state,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
    ...(session.workspaceUri && { workspaceUri: session.workspaceUri }),
    ...(session.mode && { mode: session.mode }),
  };
  const workspaceInfo = { rootPath: session.workspaceUri ? new URL(session.workspaceUri).pathname : process.cwd(), hasUncommittedChanges: false };
  const result: SessionLoadResponse['result'] = {
    sessionInfo,
    workspaceInfo,
    historyAvailable: session.messageHistory.length > 0,
  };
  if (includeHistory && session.messageHistory.length > 0) (result as any).history = session.messageHistory; // eslint-disable-line @typescript-eslint/no-explicit-any
  return result;
}

export default sessionLoadHandler;
