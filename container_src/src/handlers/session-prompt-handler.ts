import { acpState } from './acp-state.js';
import type {
  SessionPromptRequest,
  SessionPromptResponse,
  ContentBlock,
} from '../types/acp-messages.js';
import type { RequestContext } from '../services/stdio-jsonrpc.js';
import { getRuntimeServices } from '../config/runtime-services.js';

function validateContentBlocks(blocks: ContentBlock[]) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw Object.assign(
      new Error('Invalid params: content must be non-empty array'),
      { code: -32602 },
    );
  }
}

export async function sessionPromptHandler(
  params: SessionPromptRequest['params'],
  requestContext: RequestContext | unknown,
  notificationSender?: (method: string, params: any) => void, // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<SessionPromptResponse['result']> {
  acpState.ensureInitialized();
  const { sessionStore, promptProcessor } = getRuntimeServices();
  if (!params || !params.sessionId || !params.content) {
    throw Object.assign(
      new Error('Invalid params: sessionId & content required'),
      { code: -32602 },
    );
  }

  const rawParams = params as Record<string, unknown>;
  const sessionId = rawParams.sessionId as string;
  const content = rawParams.content as ContentBlock[];
  const contextFiles = rawParams.contextFiles as string[] | undefined;
  const agentContextParam = rawParams.agentContext as
    | Record<string, unknown>
    | undefined;
  const supplementalContext = rawParams.context as
    | Record<string, unknown>
    | undefined;
  const mergedAgentContext = combineAgentContexts(
    agentContextParam,
    supplementalContext,
  );
  const anthropicApiKey = rawParams.anthropicApiKey as string | undefined; // optional per worker bridge
  const apiKey =
    (anthropicApiKey as string | undefined) ||
    (typeof requestContext === 'object' &&
    requestContext &&
    'metadata' in requestContext
      ? (requestContext as RequestContext).metadata?.anthropicApiKey
      : undefined) ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENROUTER_API_KEY;
  validateContentBlocks(content);

  console.error(
    `[SESSION-PROMPT] Looking for session ${sessionId}, total sessions: ${acpState.getSessionCount()}`,
  );
  console.error(
    `[SESSION-PROMPT] Available sessions: ${acpState
      .getAllSessions()
      .map((s) => s.sessionId)
      .join(', ')}`,
  );

  // CRITICAL DEBUG: Log what we received
  console.error(`[SESSION-PROMPT-DEBUG] Request received:`, {
    sessionId,
    contentLength: content.length,
    hasContextFiles: !!contextFiles,
    hasAgentContext: !!agentContextParam,
    hasSupplementalContext: !!supplementalContext,
    agentContextKeys: agentContextParam ? Object.keys(agentContextParam) : [],
    supplementalContextKeys: supplementalContext ? Object.keys(supplementalContext) : [],
  });

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
    throw Object.assign(new Error(`Session not found: ${sessionId}`), {
      code: -32001,
    });
  }

  const operationId = `prompt-${Date.now()}`;
  // Track operation in state (for future enhanced cancellation)
  acpState.startOperation(sessionId, operationId);
  if (mergedAgentContext) {
    session.agentContext = combineAgentContexts(
      session.agentContext,
      mergedAgentContext,
    );
    
    // Hydrate history if provided in context (replaces "amnesia" with "memory")
    const incomingHistory = mergedAgentContext.messageHistory as ContentBlock[][] | undefined;
    
    console.error(`[SESSION-PROMPT-TRACE] mergedAgentContext keys: ${Object.keys(mergedAgentContext)}`);
    console.error(`[SESSION-PROMPT-TRACE] incomingHistory present: ${!!incomingHistory}, isArray: ${Array.isArray(incomingHistory)}, length: ${incomingHistory?.length}`);
    console.error(`[SESSION-PROMPT-TRACE] current session history length: ${session.messageHistory.length}`);

    if (incomingHistory && Array.isArray(incomingHistory) && session.messageHistory.length === 0) {
       // Force update history
       (session as any).messageHistory = incomingHistory;
       console.error(`[SESSION-PROMPT] Hydrated session ${sessionId} with ${incomingHistory.length} history items from request.`);
    }
  }

  const result = await promptProcessor.processPrompt({
    sessionId,
    content,
    contextFiles,
    agentContext: mergedAgentContext ?? session.agentContext,
    apiKey,
    notificationSender,
    historyAlreadyAppended: false,
    operationId,
    sessionMeta: {
      userId:
        typeof rawParams.userId === 'string'
          ? (rawParams.userId as string)
          : undefined,
      installationId:
        typeof rawParams.installationId === 'string'
          ? (rawParams.installationId as string)
          : undefined,
    },
    githubToken:
      typeof rawParams.githubToken === 'string'
        ? (rawParams.githubToken as string)
        : undefined,
    rawParams,
  });
  acpState.completeOperation(sessionId, operationId);
  return result;
}

export default sessionPromptHandler;

function combineAgentContexts(
  base?: Record<string, unknown>,
  incoming?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!base && !incoming) return undefined;
  if (!base) return incoming ? { ...incoming } : undefined;
  if (!incoming) return base;
  const merged: Record<string, unknown> = { ...base, ...incoming };
  const baseAutomation = extractAutomation(base);
  const incomingAutomation = extractAutomation(incoming);
  if (baseAutomation || incomingAutomation) {
    merged.automation = { ...baseAutomation, ...incomingAutomation };
  }
  return merged;
}

function extractAutomation(
  context?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const raw = (context as { automation?: unknown }).automation;
  if (!raw || typeof raw !== 'object') return undefined;
  return { ...(raw as Record<string, unknown>) };
}
