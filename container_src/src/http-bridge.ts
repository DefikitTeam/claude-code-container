import {
  Agent,
  AgentSideConnection,
  AuthenticateRequest,
  AvailableCommand,
  CancelNotification,
  ClientCapabilities,
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  RequestError,
  SetSessionModeRequest,
  SetSessionModeResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from "@zed-industries/agent-client-protocol";
import { WorkerHttpClient, nodeToWebReadable, nodeToWebWritable } from "./utils.js";

/**
 * HTTP Bridge Agent - Acts as ACP agent but communicates with remote worker via HTTP
 * This allows lightweight client to work with existing ACP clients while
 * delegating actual work to remote worker
 */
export class HttpBridgeAgent implements Agent {
  private httpClient: WorkerHttpClient;
  private client: AgentSideConnection;
  private sessionMap: Map<string, string> = new Map(); // local -> remote session mapping

  constructor(client: AgentSideConnection, workerUrl: string, apiKey?: string) {
    this.client = client;
    this.httpClient = new WorkerHttpClient(workerUrl, apiKey);
  }

  async initialize(request: InitializeRequest): Promise<InitializeResponse> {
    try {
      // Forward initialize request to remote worker
      const response = await this.httpClient.sendJsonRpc('initialize', request, 'init-1');
      return response;
    } catch (error) {
      console.error('HTTP Bridge initialize error:', error);
      throw new RequestError(-32603, 'Internal error', { message: 'Failed to initialize remote worker' });
    }
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    try {
      // Forward session creation to remote worker
      const response = await this.httpClient.sendJsonRpc('session/new', params, 'session-new-1');
      
      // Map local session ID to remote session ID if needed
      if (response.sessionId) {
        this.sessionMap.set(response.sessionId, response.sessionId);
      }
      
      return response;
    } catch (error) {
      console.error('HTTP Bridge newSession error:', error);
      throw new RequestError(-32603, 'Internal error', { message: 'Failed to create session on remote worker' });
    }
  }

  async authenticate(params: AuthenticateRequest): Promise<void> {
    try {
      await this.httpClient.sendJsonRpc('authenticate', params, 'auth-1');
    } catch (error) {
      console.error('HTTP Bridge authenticate error:', error);
      throw new RequestError(-32603, 'Internal error', { message: 'Authentication failed with remote worker' });
    }
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    try {
      // Forward prompt to remote worker
      const response = await this.httpClient.sendJsonRpc('session/prompt', params, `prompt-${Date.now()}`);
      return response;
    } catch (error) {
      console.error('HTTP Bridge prompt error:', error);
      
      // Check if it's an auth error
      if (error instanceof Error && error.message.includes('auth')) {
        throw RequestError.authRequired();
      }
      
      return { stopReason: 'refusal' };
    }
  }

  async cancel(params: CancelNotification): Promise<void> {
    try {
      await this.httpClient.sendJsonRpc('session/cancel', params, 'cancel-1');
    } catch (error) {
      console.error('HTTP Bridge cancel error:', error);
      // Don't throw - cancellation should be best-effort
    }
  }

  async setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
    try {
      const response = await this.httpClient.sendJsonRpc('session/setMode', params, 'mode-1');
      return response || {};
    } catch (error) {
      console.error('HTTP Bridge setSessionMode error:', error);
      throw new RequestError(-32603, 'Internal error', { message: 'Failed to set session mode on remote worker' });
    }
  }

  async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    try {
      // For file operations, try local first, then delegate to worker if needed
      const response = await this.httpClient.sendJsonRpc('fs/readTextFile', params, 'read-1');
      return response;
    } catch (error) {
      console.error('HTTP Bridge readTextFile error:', error);
      throw new RequestError(-32603, 'Internal error', { message: 'Failed to read file via remote worker' });
    }
  }

  async writeTextFile(params: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    try {
      const response = await this.httpClient.sendJsonRpc('fs/writeTextFile', params, 'write-1');
      return response;
    } catch (error) {
      console.error('HTTP Bridge writeTextFile error:', error);
      throw new RequestError(-32603, 'Internal error', { message: 'Failed to write file via remote worker' });
    }
  }
}

/**
 * Run HTTP Bridge mode
 * This creates an ACP agent that looks like a normal ACP agent to clients
 * but actually forwards all requests to a remote worker via HTTP
 */
export async function runHttpBridge(argv: any): Promise<void> {
  const workerUrl = argv['worker-url'] || process.env.WORKER_URL || 'https://your-worker-domain.com';
  const apiKey = argv['api-key'] || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY is required for HTTP bridge mode');
    process.exit(1);
  }

  console.error(`Starting HTTP Bridge mode, connecting to worker: ${workerUrl}`);

  // Create ACP connection using stdin/stdout (same as normal ACP agent)
  // but with HttpBridgeAgent that forwards to remote worker
  new AgentSideConnection(
    (client) => new HttpBridgeAgent(client, workerUrl, apiKey),
    nodeToWebWritable(process.stdout),
    nodeToWebReadable(process.stdin)
  );

  console.error('HTTP Bridge agent started, ready for ACP communication');
}