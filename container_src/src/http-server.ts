import * as http from 'http';
import { query, type SDKMessage } from '@anthropic-ai/claude-code';

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

// Enhanced logging utility with context
function logWithContext(context: string, message: string, data?: any): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${context}] ${message}`;

  if (data) {
    console.error(logMessage, JSON.stringify(data, null, 2));
  } else {
    console.error(logMessage);
  }
}

// Basic health check handler
async function healthHandler(_req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  logWithContext('HEALTH', 'Health check requested');

  const response: HealthStatus = {
    status: 'healthy',
    message: 'Claude Code Container HTTP Server',
    timestamp: new Date().toISOString(),
    claudeCodeAvailable: !!process.env.ANTHROPIC_API_KEY,
    apiKeyAvailable: !!process.env.ANTHROPIC_API_KEY
  };

  logWithContext('HEALTH', 'Health check response', {
    status: response.status,
    claudeCodeAvailable: response.claudeCodeAvailable,
    apiKeyAvailable: response.apiKeyAvailable
  });

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response));
}

// Read request body helper
function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      resolve(body);
    });
    req.on('error', reject);
  });
}

// ACP JSON-RPC handler
async function acpHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  logWithContext('ACP', 'ACP JSON-RPC request received');

  try {
    const body = await readRequestBody(req);
    let jsonRpcRequest;
    
    try {
      jsonRpcRequest = JSON.parse(body);
    } catch (parseError) {
      logWithContext('ACP', 'Invalid JSON in request body', { error: parseError });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error" },
        id: null
      }));
      return;
    }

    logWithContext('ACP', 'Processing ACP method', { 
      method: jsonRpcRequest.method, 
      id: jsonRpcRequest.id 
    });

    // Handle ACP methods
    let result;
    switch (jsonRpcRequest.method) {
      case 'initialize':
        result = {
          agentId: "claude-code-container",
          version: "1.0.0",
          protocolVersion: "0.3.1",
          capabilities: {
            sessionManagement: true,
            fileOperations: true,
            codeGeneration: true,
            taskExecution: true
          }
        };
        break;

      case 'session/new':
        const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        result = {
          sessionId: sessionId,
          status: "created"
        };
        logWithContext('ACP', 'Created new session', { sessionId });
        break;

      case 'session/prompt':
        // This would integrate with Claude Code SDK
        result = {
          response: "ACP prompt processing not fully implemented yet",
          stopReason: "success"
        };
        break;

      default:
        logWithContext('ACP', 'Unknown ACP method', { method: jsonRpcRequest.method });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32601, message: "Method not found" },
          id: jsonRpcRequest.id
        }));
        return;
    }

    // Send successful response
    const response = {
      jsonrpc: "2.0",
      result: result,
      id: jsonRpcRequest.id
    };

    logWithContext('ACP', 'ACP method processed successfully', { 
      method: jsonRpcRequest.method,
      resultKeys: Object.keys(result)
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));

  } catch (error) {
    logWithContext('ACP', 'Error processing ACP request', { error });
    
    const errorResponse = {
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Internal error",
        data: error instanceof Error ? error.message : String(error) 
      },
      id: null
    };

    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(errorResponse));
  }
}

// Process request handler (placeholder for now)
async function processHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  logWithContext('PROCESS', 'Process request received');

  try {
    const body = await readRequestBody(req);
    let requestData;
    
    try {
      requestData = JSON.parse(body);
    } catch (parseError) {
      logWithContext('PROCESS', 'Invalid JSON in request body', { error: parseError });
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Invalid JSON in request body' }));
      return;
    }

    logWithContext('PROCESS', 'Processing request', { type: requestData.type });

    // Basic processing - can be expanded based on request type
    const response: ContainerResponse = {
      success: true,
      message: 'Request processed successfully',
      logs: [`Processed request of type: ${requestData.type || 'unknown'}`]
    };

    logWithContext('PROCESS', 'Request processed successfully');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  } catch (error) {
    logWithContext('PROCESS', 'Error processing request', { error });
    
    const errorResponse: ContainerResponse = {
      success: false,
      message: 'Error processing request',
      error: error instanceof Error ? error.message : String(error)
    };

    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(errorResponse));
  }
}

// Request handler
async function requestHandler(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url || '';
  const method = req.method || 'GET';

  logWithContext('HTTP', 'Request received', { method, url });

  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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
    res.end(JSON.stringify({ 
      success: false, 
      message: 'Internal server error',
      error: error instanceof Error ? error.message : String(error)
    }));
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
    logWithContext('SERVER', 'Routes available: GET /health, POST /process, POST /acp');
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