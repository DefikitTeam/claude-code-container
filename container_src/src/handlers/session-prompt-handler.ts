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
  notificationSender?: (method: string, params: unknown) => void,
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
  const orchestrationContext =
    (supplementalContext &&
    typeof supplementalContext === 'object' &&
    'orchestration' in supplementalContext
      ? (supplementalContext as { orchestration?: Record<string, unknown> })
          .orchestration
      : undefined) ?? undefined;
  const mergedAgentContext = combineAgentContexts(
    agentContextParam,
    supplementalContext,
  );
  const mergedAgentContextWithOrchestration = combineAgentContexts(
    mergedAgentContext,
    orchestrationContext ? { orchestration: orchestrationContext } : undefined,
  );
  const anthropicApiKey = rawParams.anthropicApiKey as string | undefined; // optional per worker bridge
  const apiKey =
    (anthropicApiKey as string | undefined) ||
    (typeof requestContext === 'object' &&
    requestContext !== null &&
    'metadata' in requestContext
      ? ((requestContext as RequestContext).metadata?.anthropicApiKey as string | undefined)
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
    supplementalContextKeys: supplementalContext
      ? Object.keys(supplementalContext)
      : [],
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

  // Prevent concurrent prompt executions for the same session/workspace.
  // Concurrent git operations on a shallow clone can corrupt .git state and break
  // downstream automation (e.g., "fatal: shallow file has changed since we read it").
  if (acpState.hasActiveOperations(sessionId)) {
    const count = acpState.getActiveOperationCount(sessionId);
    throw Object.assign(new Error('operation_already_in_progress'), {
      code: -32009,
      data: { sessionId, activeOperationCount: count },
    });
  }

  const operationId = `prompt-${Date.now()}`;
  // Track operation in state (for future enhanced cancellation)
  acpState.startOperation(sessionId, operationId);
  if (mergedAgentContextWithOrchestration) {
    session.agentContext = combineAgentContexts(
      session.agentContext,
      mergedAgentContextWithOrchestration,
    );

    // Hydrate history if provided in context (replaces "amnesia" with "memory")
    const incomingHistory =
      mergedAgentContextWithOrchestration.messageHistory as
        | ContentBlock[][]
        | undefined;

    console.error(
      `[SESSION-PROMPT-TRACE] mergedAgentContext keys: ${Object.keys(mergedAgentContextWithOrchestration)}`,
    );
    console.error(
      `[SESSION-PROMPT-TRACE] incomingHistory present: ${!!incomingHistory}, isArray: ${Array.isArray(incomingHistory)}, length: ${incomingHistory?.length}`,
    );
    console.error(
      `[SESSION-PROMPT-TRACE] current session history length: ${session.messageHistory.length}`,
    );

    if (incomingHistory) {
      console.error(
        `[SESSION-PROMPT-DEBUG] incomingHistory type: ${typeof incomingHistory}`,
      );
      console.error(
        `[SESSION-PROMPT-DEBUG] incomingHistory isArray: ${Array.isArray(incomingHistory)}`,
      );
      if (Array.isArray(incomingHistory)) {
        console.error(
          `[SESSION-PROMPT-DEBUG] incomingHistory length: ${incomingHistory.length}`,
        );
      } else {
        console.error(
          `[SESSION-PROMPT-DEBUG] incomingHistory JSON: ${JSON.stringify(incomingHistory).substring(0, 200)}`,
        );
        // Attempt to parse if string
        if (typeof incomingHistory === 'string') {
          try {
            const parsed = JSON.parse(incomingHistory);
            if (Array.isArray(parsed)) {
              console.error(
                `[SESSION-PROMPT-DEBUG] incomingHistory was stringified JSON array, parsing...`,
              );
              session.messageHistory = parsed as ContentBlock[][];
            }
          } catch (e) {
            console.error(
              `[SESSION-PROMPT-DEBUG] Failed to parse string history: ${e}`,
            );
          }
        }
      }
    }

    if (incomingHistory && Array.isArray(incomingHistory)) {
      // Force update history
      session.messageHistory = incomingHistory;
      console.error(
        `[SESSION-PROMPT] Hydrated session ${sessionId} with ${incomingHistory.length} history items from request.`,
      );

      // DEBUG: Log the first item to understand structure (Array vs Object)
      if (incomingHistory.length > 0) {
        console.error(
          `[SESSION-PROMPT-DEBUG] First history item: ${JSON.stringify(incomingHistory[0]).substring(0, 500)}`,
        );
        console.error(
          `[SESSION-PROMPT-DEBUG] First item type: ${typeof incomingHistory[0]}, isArray: ${Array.isArray(incomingHistory[0])}`,
        );
      }
    }
  }

  try {
    const result = await promptProcessor.processPrompt({
      sessionId,
      content,
      contextFiles,
      agentContext: mergedAgentContextWithOrchestration ?? session.agentContext,
      apiKey,
      notificationSender,
      historyAlreadyAppended: false,
      operationId,
      session, // PASS THE HYDRATED SESSION!
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
    return result;
  } finally {
    acpState.completeOperation(sessionId, operationId);
  }
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
