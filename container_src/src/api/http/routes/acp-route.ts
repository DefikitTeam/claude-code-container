import { logWithContext } from '../utils/logger.js';
import { jsonResponse } from '../utils/responses.js';
import { parseJsonBody, readRequestBody } from '../utils/body.js';
import type { Router } from '../router.js';
import type { RequestContext } from '../../../services/stdio-jsonrpc.js';
import { initializeHandler } from '../../../handlers/initialize-handler.js';
import { sessionNewHandler } from '../../../handlers/session-new-handler.js';
import { sessionPromptHandler } from '../../../handlers/session-prompt-handler.js';
import { sessionLoadHandler } from '../../../handlers/session-load-handler.js';
import { cancelHandler } from '../../../handlers/cancel-handler.js';
import type {
  InitializeRequest,
  SessionNewRequest,
  SessionPromptRequest,
  SessionLoadRequest,
  CancelRequest,
} from '../../../types/acp-messages.js';

interface JsonRpcRequest {
  jsonrpc: string;
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  result: unknown;
  id: JsonRpcRequest['id'];
}

interface JsonRpcError {
  jsonrpc: '2.0';
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
  id: JsonRpcRequest['id'];
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

function buildRequestContext(
  requestId: JsonRpcRequest['id'],
  params: Record<string, unknown> | undefined,
): RequestContext {
  const id =
    requestId === null || requestId === undefined
      ? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      : String(requestId);

  // Debug logging to trace API key
  console.error('[ACP-ROUTE] Building request context:', {
    hasParams: !!params,
    paramsKeys: params ? Object.keys(params) : [],
    hasAnthropicApiKey: !!(params && params.anthropicApiKey),
    anthropicApiKeySource: params?.anthropicApiKey
      ? 'params'
      : process.env.ANTHROPIC_API_KEY
        ? 'env'
        : 'missing',
  });

  const metadata = {
    userId: getString(params, ['userId']) ?? 'http-server',
    sessionId: getString(params, ['sessionId']),
    anthropicApiKey:
      getString(params, ['anthropicApiKey']) ?? process.env.ANTHROPIC_API_KEY,
    githubToken: getString(params, ['githubToken']) ?? process.env.GITHUB_TOKEN, // ✅ Extract GitHub token from params
    workspaceUri: getString(params, ['configuration', 'workspaceUri']),
    repository: getValue(params, ['context', 'repository']),
    operation: getValue(params, ['context', 'operation']),
  };

  console.error('[ACP-ROUTE] Metadata built:', {
    userId: metadata.userId,
    hasAnthropicApiKey: !!metadata.anthropicApiKey,
    hasGithubToken: !!metadata.githubToken,
    hasRepository: !!metadata.repository,
  });

  return {
    requestId: id,
    timestamp: Date.now(),
    metadata,
  };
}

function getString(
  source: Record<string, unknown> | undefined,
  path: string[],
): string | undefined {
  const value = getValue(source, path);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getValue(
  source: Record<string, unknown> | undefined,
  path: string[],
): any {
  if (!source) return undefined;
  let current: any = source;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

async function dispatchJsonRpc(
  request: JsonRpcRequest,
): Promise<JsonRpcResponse> {
  const params = request.params ?? {};
  const ctx = buildRequestContext(request.id, params);

  try {
    let result: unknown;

    switch (request.method) {
      case 'initialize':
        result = await initializeHandler(
          params as InitializeRequest['params'],
          ctx,
        );
        break;
      case 'session/new':
        result = await sessionNewHandler(
          params as SessionNewRequest['params'],
          ctx,
        );
        break;
      case 'session/prompt': {
        const notifier = (method: string, payload: unknown) =>
          logWithContext('ACP', 'Notification', {
            method,
            payload,
            requestId: ctx.requestId,
          });
        result = await sessionPromptHandler(
          params as SessionPromptRequest['params'],
          ctx,
          notifier,
        );
        break;
      }
      case 'session/load':
        result = await sessionLoadHandler(
          params as SessionLoadRequest['params'],
          ctx,
        );
        break;
      case 'cancel':
        result = await cancelHandler(params as CancelRequest['params'], ctx);
        break;
      default:
        return {
          jsonrpc: '2.0',
          error: { code: -32601, message: 'Method not found' },
          id: request.id ?? null,
        };
    }

    return { jsonrpc: '2.0', result, id: request.id ?? null };
  } catch (error) {
    logWithContext('ACP', 'Handler error', {
      method: request.method,
      requestId: ctx.requestId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Internal error',
        data: error instanceof Error ? error.message : String(error),
      },
      id: request.id ?? null,
    };
  }
}

export function registerAcpRoutes(router: Router): void {
  router.register('POST', '/acp', async (ctx) => {
    logWithContext('ACP', 'ACP JSON-RPC request received', {
      requestId: ctx.requestId,
    });

    let request: JsonRpcRequest;
    try {
      const raw = await readRequestBody(ctx.req);
      request = parseJsonBody<JsonRpcRequest>(raw);
    } catch (error) {
      logWithContext('ACP', 'Invalid JSON in request body', {
        requestId: ctx.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      jsonResponse(ctx.res, 400, {
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error' },
        id: null,
      });
      return;
    }

    logWithContext('ACP', 'Processing ACP method', {
      method: request.method,
      id: request.id,
      requestId: ctx.requestId,
    });

    const response = await dispatchJsonRpc(request);
    jsonResponse(ctx.res, 200, response);
  });

  router.register('POST', '/acp/initialize', async (ctx) => {
    const raw = await readRequestBody(ctx.req);
    const params = parseJsonBody<Record<string, unknown>>(raw);
    const rpcRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'initialize',
      params,
    };
    const response = await dispatchJsonRpc(rpcRequest);
    jsonResponse(ctx.res, 200, response);
  });

  router.register('POST', '/acp/session/prompt', async (ctx) => {
    const raw = await readRequestBody(ctx.req);
    const params = parseJsonBody<Record<string, unknown>>(raw);
    const rpcRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'session/prompt',
      params,
    };
    const response = await dispatchJsonRpc(rpcRequest);
    jsonResponse(ctx.res, 200, response);
  });
}
