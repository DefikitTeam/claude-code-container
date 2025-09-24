import { v4 as uuidv4 } from 'uuid';
import { acpState } from './acp-state';
import type { SessionNewRequest, SessionNewResponse } from '../types/acp-messages.js';
import type { ACPSession, SessionMode } from '../types/acp-session.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RequestContext } from '../services/stdio-jsonrpc';

function generateSessionId(): string { return `session-${uuidv4()}`; }

async function createWorkspaceInfo(workspaceUri?: string, sessionOptions?: ACPSession['sessionOptions']) {
  const rootPath = workspaceUri ? new URL(workspaceUri).pathname : process.cwd();
  const info = { rootPath, hasUncommittedChanges: false } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    await fs.access(rootPath, fs.constants.R_OK | fs.constants.W_OK);
    if (sessionOptions?.enableGitOps) {
      try {
        const gitPath = path.join(rootPath, '.git');
        await fs.access(gitPath);
        info.gitBranch = 'main'; // lightweight placeholder (full branch detection in workspace service path elsewhere)
      } catch {}
    }
  } catch {}
  return info;
}

export async function sessionNewHandler(
params: SessionNewRequest['params'] = {}, requestContext: RequestContext,
): Promise<SessionNewResponse['result']> {
  if (!acpState.isInitialized()) {
    throw Object.assign(new Error('Agent not initialized'), { code: -32000 });
  }
  const { workspaceUri, mode = 'development', sessionOptions } = params;
  if (mode && !['development', 'conversation'].includes(mode)) {
    throw Object.assign(new Error(`Invalid mode: ${mode}`), { code: -32602 });
  }

  const sessionId = generateSessionId();
  const now = Date.now();
  const session: ACPSession = {
    sessionId,
    workspaceUri,
    mode: mode as SessionMode,
    state: 'active',
    createdAt: now,
    lastActiveAt: now,
    messageHistory: [],
    sessionOptions,
  };
  acpState.setSession(sessionId, session);
  const workspaceInfo = await createWorkspaceInfo(workspaceUri, sessionOptions);
  return { sessionId, workspaceInfo };
}

export default sessionNewHandler;
