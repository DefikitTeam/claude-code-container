import { acpState } from './acp-state';
import type { SessionPromptRequest, SessionPromptResponse, ContentBlock } from '../types/acp-messages.js';
import { PromptProcessor } from '../services/prompt/prompt-processor.js';
import { claudeClientSingleton } from '../services/claude/claude-client.js';
import { WorkspaceService } from '../services/workspace/workspace-service.js';
import { SessionStore } from '../services/session/session-store.js';

// Basic DI singletons (could be hoisted elsewhere):
const sessionStore = new SessionStore();
const workspaceService = new WorkspaceService();
const promptProcessor = new PromptProcessor({
  sessionStore: sessionStore as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  workspaceService,
  claudeClient: claudeClientSingleton,
});

function validateContentBlocks(blocks: ContentBlock[]) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw Object.assign(new Error('Invalid params: content must be non-empty array'), { code: -32602 });
  }
}

export async function sessionPromptHandler(
  params: SessionPromptRequest['params'],
  _context: unknown,
  notificationSender?: (method: string, params: any) => void, // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<SessionPromptResponse['result']> {
  if (!acpState.isInitialized()) {
    throw Object.assign(new Error('Agent not initialized'), { code: -32000 });
  }
  if (!params || !params.sessionId || !params.content) {
    throw Object.assign(new Error('Invalid params: sessionId & content required'), { code: -32602 });
  }

  const { sessionId, content, contextFiles, agentContext } = params;
  validateContentBlocks(content);

  const session = acpState.getSession(sessionId);
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
    notificationSender,
    historyAlreadyAppended: false,
    operationId,
  });
  acpState.completeOperation(sessionId, operationId);
  return result;
}

export default sessionPromptHandler;
