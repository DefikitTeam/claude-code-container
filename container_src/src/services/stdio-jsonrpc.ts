/**
 * Stdio JSON-RPC Handler for ACP Protocol
 * Handles JSON-RPC communication over stdin/stdout for Agent Client Protocol
 */

import { EventEmitter } from 'events';
import postToBroker from '../api/utils/streaming.js';
import { getStreamBrokerConfig } from '../config/index.js';
import {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,
  JSONRPCError,
  ACP_ERROR_CODES,
} from '../types/acp-messages.js';

export interface JSONRPCHandler {
  method: string;
  handler: (params: any, context: RequestContext) => Promise<any>;
}

export interface RequestContext {
  requestId: string | number | null;
  timestamp: number;
  metadata?: Record<string, any>;
}

export class StdioJSONRPCServer extends EventEmitter {
  private handlers = new Map<string, JSONRPCHandler['handler']>();
  private isRunning = false;
  private buffer = '';
  private seqCounters = new Map<string, number>();

  constructor() {
    super();
    this.setupStdinHandling();
  }

  /**
   * Register a method handler
   */
  addHandler(method: string, handler: JSONRPCHandler['handler']): void {
    this.handlers.set(method, handler);
  }

  /**
   * Start the JSON-RPC server
   */
  start(): void {
    if (this.isRunning) {
      throw new Error('JSON-RPC server is already running');
    }

    this.isRunning = true;
    this.emit('server:started');

    // In stdio mode, we don't need to explicitly listen
    // stdin handling is already set up in constructor
  }

  /**
   * Stop the JSON-RPC server
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.emit('server:stopped');
  }

  /**
   * Set up stdin handling for JSON-RPC messages
   */
  private setupStdinHandling(): void {
    if (!process.stdin) {
      throw new Error('stdin is not available');
    }

    process.stdin.setEncoding('utf8');
    process.stdin.on('readable', () => {
      let chunk;
      while (null !== (chunk = process.stdin.read())) {
        this.buffer += chunk;
        this.processBuffer();
      }
    });

    process.stdin.on('end', () => {
      this.emit('stdin:end');
      this.stop();
    });

    process.stdin.on('error', (error) => {
      this.emit('error', error);
    });
  }

  /**
   * Process buffered input for complete JSON-RPC messages
   */
  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        this.processMessage(trimmed);
      }
    }
  }

  /**
   * Process a single JSON-RPC message
   */
  private async processMessage(messageText: string): Promise<void> {
    try {
      const message = JSON.parse(messageText);

      // Validate JSON-RPC format
      if (!this.isValidJSONRPC(message)) {
        // Try to preserve the id from the message if available
        const messageId =
          message && typeof message === 'object' && message.id !== undefined
            ? message.id
            : null;
        const error = this.createErrorResponse(
          messageId,
          ACP_ERROR_CODES.INVALID_REQUEST,
          'Invalid Request',
        );
        this.sendResponse(error);
        return;
      }

      const context: RequestContext = {
        requestId: message.id || null,
        timestamp: Date.now(),
        metadata: { method: message.method },
      };

      // Handle notifications (no response expected)
      if (this.isNotification(message)) {
        await this.handleNotification(message as JSONRPCNotification, context);
        return;
      }

      // Handle requests (response expected)
      const request = message as JSONRPCRequest;
      await this.handleRequest(request, context);
    } catch (parseError) {
      const error = this.createErrorResponse(
        null,
        ACP_ERROR_CODES.PARSE_ERROR,
        'Invalid JSON format',
      );
      this.sendResponse(error);
    }
  }

  /**
   * Handle JSON-RPC request
   */
  private async handleRequest(
    request: JSONRPCRequest,
    context: RequestContext,
  ): Promise<void> {
    const { method, params, id } = request;

    try {
      const handler = this.handlers.get(method);

      if (!handler) {
        const error = this.createErrorResponse(
          id,
          ACP_ERROR_CODES.METHOD_NOT_FOUND,
          `method not found: ${method}`,
        );
        this.sendResponse(error);
        return;
      }

      this.emit('request:received', { method, params, id, context });

      const result = await handler(params, context);

      const response: JSONRPCResponse = {
        jsonrpc: '2.0',
        id,
        result,
      };

      this.sendResponse(response);
      this.emit('request:completed', { method, params, id, result, context });
    } catch (handlerError) {
      // Extract error details from thrown Error object
      let errorCode = ACP_ERROR_CODES.INTERNAL_ERROR;
      let errorMessage = 'Unknown error';
      let errorData: any = undefined;

      if (handlerError instanceof Error) {
        errorMessage = handlerError.message;
        // Check if it's a custom ACP error with code and data
        if ((handlerError as any).code !== undefined) {
          errorCode = (handlerError as any).code;
        }
        if ((handlerError as any).data !== undefined) {
          errorData = (handlerError as any).data;
        }
      } else if (typeof handlerError === 'string') {
        errorMessage = handlerError;
      } else {
        errorMessage = String(handlerError);
      }

      const error = this.createErrorResponse(
        id,
        errorCode,
        errorMessage,
        errorData,
      );
      this.sendResponse(error);
      this.emit('request:error', {
        method,
        params,
        id,
        error: handlerError,
        context,
      });
    }
  }

  /**
   * Handle JSON-RPC notification
   */
  private async handleNotification(
    notification: JSONRPCNotification,
    context: RequestContext,
  ): Promise<void> {
    const { method, params } = notification;

    try {
      const handler = this.handlers.get(method);

      if (handler) {
        await handler(params, context);
        this.emit('notification:processed', { method, params, context });
      } else {
        // Notifications for unknown methods are silently ignored per JSON-RPC spec
        this.emit('notification:ignored', { method, params, context });
      }
    } catch (handlerError) {
      // Notifications don't return errors, but we can emit for logging
      this.emit('notification:error', {
        method,
        params,
        error: handlerError,
        context,
      });
    }
  }

  /**
   * Send a response or notification via stdout
   */
  private sendResponse(response: JSONRPCResponse | JSONRPCNotification): void {
    const responseText = JSON.stringify(response) + '\n';
    process.stdout.write(responseText);
    this.emit('response:sent', response);
  }

  /**
   * Send a notification to the client
   */
  sendNotification(method: string, params: any): void {
    // ensure timestamp and seqNo are present for session notifications
    if (typeof method === 'string' && method.startsWith('session/')) {
      const sessionId = params?.sessionId || params?.session?.sessionId;
      if (!params.timestamp) params.timestamp = Date.now();
      if (sessionId && params.seqNo === undefined) {
        const last = this.seqCounters.get(sessionId) ?? 0;
        const next = last + 1;
        this.seqCounters.set(sessionId, next);
        params.seqNo = next;
      }
    }

    const notification: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.sendResponse(notification);

    // Optionally POST session.* notifications to configured Stream Broker (non-blocking)
    try {
      const isSessionNotification =
        typeof method === 'string' && method.startsWith('session/');
      const cfg = getStreamBrokerConfig();
      const envSet = !!cfg.url;
      const requestedStream = params && params.stream === true;
      const streamEnabled = !!cfg.enabled;
      if (isSessionNotification && (envSet || requestedStream)) {
        // gate by explicit config flag (T021)
        if (!streamEnabled) return;
        const sessionId = params?.sessionId || params?.session?.sessionId;
        if (sessionId) {
          // Fire-and-forget: post but attach .catch to avoid unhandled promise rejection
          postToBroker(
            sessionId,
            { method, params },
            params?.streamToken,
          ).catch((err) => {
            console.error('[postToBroker] async error', err);
          });
        } else {
          console.warn(
            '[postToBroker] Missing sessionId for session notification; skipping broker post',
          );
        }
      }
    } catch (err) {
      // Protect notification path from broker errors; log and continue
      console.error('[postToBroker] unexpected error in sendNotification', err);
    }
  }

  /**
   * Validate JSON-RPC message format
   */
  private isValidJSONRPC(message: any): boolean {
    return (
      typeof message === 'object' &&
      message !== null &&
      message.jsonrpc === '2.0' &&
      typeof message.method === 'string' &&
      (message.id === undefined ||
        typeof message.id === 'string' ||
        typeof message.id === 'number' ||
        message.id === null)
    );
  }

  /**
   * Check if message is a notification (no id field)
   */
  private isNotification(message: any): boolean {
    return message.id === undefined;
  }

  /**
   * Create standardized error response
   */
  private createErrorResponse(
    id: string | number | null,
    code: number,
    message: string,
    data?: any,
  ): JSONRPCResponse {
    const error: JSONRPCError = {
      code,
      message,
      ...(data && { data }),
    };

    return {
      jsonrpc: '2.0',
      id,
      error,
    };
  }

  /**
   * Get server status
   */
  getStatus(): { isRunning: boolean; handlerCount: number; methods: string[] } {
    return {
      isRunning: this.isRunning,
      handlerCount: this.handlers.size,
      methods: Array.from(this.handlers.keys()),
    };
  }

  /**
   * Remove a method handler
   */
  removeHandler(method: string): boolean {
    return this.handlers.delete(method);
  }

  /**
   * Check if a method handler exists
   */
  hasHandler(method: string): boolean {
    return this.handlers.has(method);
  }

  /**
   * Get all registered method names
   */
  getRegisteredMethods(): string[] {
    return Array.from(this.handlers.keys());
  }
}

/**
 * Utility function to create a stdio JSON-RPC server with error handling
 */
export function createStdioJSONRPCServer(): StdioJSONRPCServer {
  const server = new StdioJSONRPCServer();

  // Add global error handling
  server.on('error', (error) => {
    console.error('[JSON-RPC Server Error]', error);
  });

  // Add request logging for debugging (suppress in test mode)
  if (process.env.NODE_ENV !== 'test') {
    server.on('request:received', ({ method, id }) => {
      console.error(`[JSON-RPC] Request received: ${method} (id: ${id})`);
    });

    server.on('request:completed', ({ method, id }) => {
      console.error(`[JSON-RPC] Request completed: ${method} (id: ${id})`);
    });

    server.on('request:error', ({ method, id, error }) => {
      console.error(`[JSON-RPC] Request error: ${method} (id: ${id})`, error);
    });
  }

  return server;
}
