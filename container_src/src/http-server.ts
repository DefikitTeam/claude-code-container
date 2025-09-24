import * as http from 'http';
import { query, type SDKMessage } from '@anthropic-ai/claude-code';
import { initializeHandler as handleInitialize } from './handlers/initialize-handler.js';
import { sessionNewHandler as handleSessionNew } from './handlers/session-new-handler.js';
import { sessionPromptHandler as handleSessionPrompt } from './handlers/session-prompt-handler.js';
import { sessionLoadHandler as handleSessionLoad } from './handlers/session-load-handler.js';
import { cancelHandler as handleCancel } from './handlers/cancel-handler.js';
import { RequestContext } from './services/stdio-jsonrpc.js';

const PORT = parseInt(process.env.PORT || '8080');

// Health check response interface
interface HealthStatus {
  status: string;
  message: string;
  timestamp: string;
  claudeCodeAvailable: boolean;
  apiKeyAvailable: boolean;
}

// Container response interface
interface ContainerResponse {
  success: boolean;
  message: string;
  error?: string;
  pullRequestUrl?: string;
  logs?: string[];
}

// Container instance ID for debugging
const CONTAINER_INSTANCE_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

// Enhanced logging utility with context
function logWithContext(context: string, message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${context}] [${CONTAINER_INSTANCE_ID}] ${message}`;

  if (data) {
    console.error(logMessage, JSON.stringify(data, null, 2));
  } else {
    console.error(logMessage);
  }
}

// Basic health check handler
async function healthHandler(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  logWithContext('HEALTH', 'Health check requested');

  // Check Claude CLI availability
  let claudeCliAvailable = false;
  try {
    const { execSync } = await import('node:child_process');
    execSync('claude --version', { timeout: 5000, stdio: 'pipe' });
    claudeCliAvailable = true;
  } catch (error) {
    console.warn(
      '[HEALTH] Claude CLI not available:',
      (error as Error).message,
    );
  }

  const response: HealthStatus = {
    status: claudeCliAvailable ? 'healthy' : 'degraded',
    message: claudeCliAvailable
      ? 'Claude Code Container HTTP Server'
      : 'Claude Code Container HTTP Server (Claude CLI not authenticated)',
    timestamp: new Date().toISOString(),
    claudeCodeAvailable: claudeCliAvailable,
    apiKeyAvailable: !!process.env.ANTHROPIC_API_KEY,
  };

  logWithContext('HEALTH', 'Health check response', {
    status: response.status,
    claudeCodeAvailable: response.claudeCodeAvailable,
    apiKeyAvailable: response.apiKeyAvailable,
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response));
}

// Read request body helper
function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      resolve(body);
    });
    req.on('error', reject);
  });
}

// ACP JSON-RPC handler
async function acpHandler(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  logWithContext('ACP', 'ACP JSON-RPC request received');

  try {
    const body = await readRequestBody(req);
    let jsonRpcRequest;

    try {
      jsonRpcRequest = JSON.parse(body);
    } catch (parseError) {
      logWithContext('ACP', 'Invalid JSON in request body', {
        error: parseError,
      });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32700, message: 'Parse error' },
          id: null,
        }),
      );
      return;
    }

    logWithContext('ACP', 'Processing ACP method', {
      method: jsonRpcRequest.method,
      id: jsonRpcRequest.id,
    });

    // Handle ACP methods using real implementations
    let result;

    // Create request context for handlers
    const requestContext: RequestContext = {
      requestId: jsonRpcRequest.id,
      timestamp: Date.now(),
      metadata: {
        userId: jsonRpcRequest.params?.userId || 'http-server',
        sessionId: jsonRpcRequest.params?.sessionId,
        anthropicApiKey:
          jsonRpcRequest.params?.anthropicApiKey ||
          process.env.ANTHROPIC_API_KEY, // Use API key from request or fallback to env
        workspaceUri: jsonRpcRequest.params?.configuration?.workspaceUri,
        repository: jsonRpcRequest.params?.context?.repository,
        operation: jsonRpcRequest.params?.context?.operation,
      },
    };

    try {
      switch (jsonRpcRequest.method) {
        case 'initialize':
          result = await handleInitialize(
            jsonRpcRequest.params || {},
            requestContext,
          );
          break;

        case 'session/new':
          result = await handleSessionNew(
            jsonRpcRequest.params || {},
            requestContext,
          );
          break;

        case 'session/prompt':
          // Create notification sender for progress updates
          const notificationSender = (method: string, params: any) => {
            logWithContext('ACP', `Notification: ${method}`, params);
            // In a real implementation, this would send WebSocket updates
          };

          result = await handleSessionPrompt(
            jsonRpcRequest.params || {},
            requestContext,
            notificationSender,
          );
          break;

        case 'session/load':
          result = await handleSessionLoad(
            jsonRpcRequest.params || {},
            requestContext,
          );
          break;

        case 'cancel':
          result = await handleCancel(
            jsonRpcRequest.params || {},
            requestContext,
          );
          break;

        default:
          logWithContext('ACP', 'Unknown ACP method', {
            method: jsonRpcRequest.method,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32601, message: 'Method not found' },
              id: jsonRpcRequest.id,
            }),
          );
          return;
      }
    } catch (handlerError) {
      logWithContext('ACP', 'Handler error', {
        method: jsonRpcRequest.method,
        error:
          handlerError instanceof Error
            ? handlerError.message
            : String(handlerError),
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal error',
            data:
              handlerError instanceof Error
                ? handlerError.message
                : String(handlerError),
          },
          id: jsonRpcRequest.id,
        }),
      );
      return;
    }

    // Send successful response
    const response = {
      jsonrpc: '2.0',
      result: result,
      id: jsonRpcRequest.id,
    };

    logWithContext('ACP', 'ACP method processed successfully', {
      method: jsonRpcRequest.method,
      resultKeys: Object.keys(result),
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  } catch (error) {
    logWithContext('ACP', 'Error processing ACP request', { error });

    const errorResponse = {
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Internal error',
        data: error instanceof Error ? error.message : String(error),
      },
      id: null,
    };

    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(errorResponse));
  }
}

// Process request handler (placeholder for now)
async function processHandler(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  logWithContext('PROCESS', 'Process request received');

  try {
    const body = await readRequestBody(req);
    let requestData;

    try {
      requestData = JSON.parse(body);
    } catch (parseError) {
      logWithContext('PROCESS', 'Invalid JSON in request body', {
        error: parseError,
      });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          message: 'Invalid JSON in request body',
        }),
      );
      return;
    }

    logWithContext('PROCESS', 'Processing request', { type: requestData.type });

    // Basic processing - can be expanded based on request type
    const response: ContainerResponse = {
      success: true,
      message: 'Request processed successfully',
      logs: [`Processed request of type: ${requestData.type || 'unknown'}`],
    };

    logWithContext('PROCESS', 'Request processed successfully');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  } catch (error) {
    logWithContext('PROCESS', 'Error processing request', { error });

    const errorResponse: ContainerResponse = {
      success: false,
      message: 'Error processing request',
      error: error instanceof Error ? error.message : String(error),
    };

    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(errorResponse));
  }
}

// Request handler
async function requestHandler(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = req.url || '';
  const method = req.method || 'GET';

  logWithContext('HTTP', 'Request received', { method, url });

  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS',
  );
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  try {
    if (url === '/health' && method === 'GET') {
      await healthHandler(req, res);
    } else if (url === '/process' && method === 'POST') {
      await processHandler(req, res);
    } else if (url === '/acp' && method === 'POST') {
      await acpHandler(req, res);
    } else {
      logWithContext('HTTP', 'Route not found', { method, url });
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Route not found' }));
    }
  } catch (error) {
    logWithContext('HTTP', 'Unhandled error in request handler', { error });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: false,
        message: 'Internal server error',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

/**
 * Run HTTP Server mode
 * This creates an HTTP server that can handle requests from Cloudflare Workers
 */
export async function runHttpServer(argv: any): Promise<void> {
  const port = argv.port || PORT;

  logWithContext('SERVER', `Starting HTTP Server on port ${port}`);

  const server = http.createServer(requestHandler);

  server.listen(port, '0.0.0.0', () => {
    logWithContext('SERVER', `HTTP Server listening on http://0.0.0.0:${port}`);
    logWithContext(
      'SERVER',
      'Routes available: GET /health, POST /process, POST /acp',
    );
  });

  server.on('error', (error) => {
    logWithContext('SERVER', 'Server error', { error });
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logWithContext('SERVER', 'Received SIGTERM, shutting down gracefully');
    server.close(() => {
      logWithContext('SERVER', 'HTTP server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    logWithContext('SERVER', 'Received SIGINT, shutting down gracefully');
    server.close(() => {
      logWithContext('SERVER', 'HTTP server closed');
      process.exit(0);
    });
  });
}