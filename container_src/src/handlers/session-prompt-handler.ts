import { acpState } from './acp-state.js';
import type { SessionPromptRequest, SessionPromptResponse, ContentBlock } from '../types/acp-messages.js';
import type { RequestContext } from '../services/stdio-jsonrpc.js';
import { PromptProcessor } from '../services/prompt/prompt-processor.js';
import { claudeClientSingleton } from '../services/claude/claude-client.js';
import { WorkspaceService } from '../services/workspace/workspace-service.js';
import { SessionStore } from '../services/session/session-store.js';
import { GitService } from '../services/git/git-service.js';

// Basic DI singletons (could be hoisted elsewhere):
const sessionStore = new SessionStore();
const workspaceService = new WorkspaceService();
const gitService = new GitService();
const promptProcessor = new PromptProcessor({
  sessionStore: sessionStore as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  workspaceService,
  claudeClient: claudeClientSingleton,
  gitService,
});

function validateContentBlocks(blocks: ContentBlock[]) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw Object.assign(new Error('Invalid params: content must be non-empty array'), { code: -32602 });
  }
}

export async function sessionPromptHandler(
  params: SessionPromptRequest['params'],
  requestContext: RequestContext | unknown,
  notificationSender?: (method: string, params: any) => void, // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<SessionPromptResponse['result']> {
  acpState.ensureInitialized();
  if (!params || !params.sessionId || !params.content) {
    throw Object.assign(new Error('Invalid params: sessionId & content required'), { code: -32602 });
  }

  const { sessionId, content, contextFiles, agentContext, anthropicApiKey } = params as any; // anthropicApiKey optional
  const apiKey = (anthropicApiKey as string | undefined)
    || (typeof requestContext === 'object' && requestContext && 'metadata' in requestContext
      ? (requestContext as RequestContext).metadata?.anthropicApiKey
      : undefined)
    || process.env.ANTHROPIC_API_KEY;
  validateContentBlocks(content);

  console.error(`[SESSION-PROMPT] Looking for session ${sessionId}, total sessions: ${acpState.getSessionCount()}`);
  console.error(`[SESSION-PROMPT] Available sessions: ${acpState.getAllSessions().map(s => s.sessionId).join(', ')}`);
  let session = acpState.getSession(sessionId);
  // if (!session) {
  //   throw Object.assign(new Error(`Session not found: ${sessionId}`), { code: -32001 });
  // }
  if (!session) {
    const persisted = await sessionStore.load(sessionId);
    if (persisted) {
      acpState.setSession(sessionId, persisted);
      session = persisted;
    }
  }
  if (!session) {
    throw Object.assign(new Error(`Session not found: ${sessionId}`), { code: -32001 });
  }

  const operationId = `prompt-${Date.now()}`;
  // Track operation in state (for future enhanced cancellation)
  acpState.startOperation(sessionId, operationId);
  const result = await promptProcessor.processPrompt({
    sessionId,
    content,
    contextFiles,
    agentContext,
    apiKey,
    notificationSender,
    historyAlreadyAppended: false,
    operationId,
  });
  acpState.completeOperation(sessionId, operationId);
  return result;
}

export default sessionPromptHandler;
