/**
 * ACP Server Integration
 * Main entry point for Agent Client Protocol functionality
 */

import { createStdioJSONRPCServer, StdioJSONRPCServer } from './services/stdio-jsonrpc.js';
import { ACPHandlers } from './handlers/acp-handlers.js';

export class ACPServer {
  private jsonrpcServer: StdioJSONRPCServer;
  private isRunning = false;

  constructor() {
    this.jsonrpcServer = createStdioJSONRPCServer();
    this.setupHandlers();
    this.setupEventHandlers();
  }

  /**
   * Register all ACP method handlers
   */
  private setupHandlers(): void {
    // Register core ACP methods
    Object.entries(ACPHandlers).forEach(([method, handler]) => {
      this.jsonrpcServer.addHandler(method, async (params, context) => {
        // For session/prompt, we need to provide the notification sender
        if (method === 'session/prompt') {
          return handler(params, context, (notifMethod, notifParams) => {
            this.jsonrpcServer.sendNotification(notifMethod, notifParams);
          });
        }
        return handler(params, context);
      });
    });

    if (process.env.NODE_ENV !== 'test') {
      console.error('[ACP Server] Registered handlers:', Object.keys(ACPHandlers));
    }
  }

  /**
   * Set up event handlers for monitoring and debugging
   */
  private setupEventHandlers(): void {
    const isTestEnv = process.env.NODE_ENV === 'test';

    this.jsonrpcServer.on('server:started', () => {
      if (!isTestEnv) console.error('[ACP Server] JSON-RPC server started');
    });

    this.jsonrpcServer.on('server:stopped', () => {
      if (!isTestEnv) console.error('[ACP Server] JSON-RPC server stopped');
    });

    this.jsonrpcServer.on('stdin:end', () => {
      if (!isTestEnv) console.error('[ACP Server] stdin ended, shutting down');
      this.stop();
    });

    this.jsonrpcServer.on('error', (error) => {
      if (!isTestEnv) console.error('[ACP Server] Error:', error);
    });

    // Request lifecycle logging
    this.jsonrpcServer.on('request:received', ({ method, id }) => {
      if (!isTestEnv) console.error(`[ACP Server] --> ${method} (${id})`);
    });

    this.jsonrpcServer.on('request:completed', ({ method, id }) => {
      if (!isTestEnv) console.error(`[ACP Server] <-- ${method} (${id}) [OK]`);
    });

    this.jsonrpcServer.on('request:error', ({ method, id, error }) => {
      if (!isTestEnv) console.error(`[ACP Server] <-- ${method} (${id}) [ERROR]`, error.message || error);
    });

    this.jsonrpcServer.on('response:sent', (response) => {
      if (!isTestEnv && 'error' in response) {
        console.error(`[ACP Server] Error response sent: ${response.error?.message}`);
      }
    });
  }

  /**
   * Start the ACP server
   */
  start(): void {
    if (this.isRunning) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('[ACP Server] Already running');
      }
      return;
    }

    this.isRunning = true;
    this.jsonrpcServer.start();

    if (process.env.NODE_ENV !== 'test') {
      console.error('[ACP Server] Started and ready for ACP communication');
      console.error('[ACP Server] Available methods:', this.jsonrpcServer.getRegisteredMethods());
    }
  }

  /**
   * Stop the ACP server
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.jsonrpcServer.stop();
    console.error('[ACP Server] Stopped');
  }

  /**
   * Get server status
   */
  getStatus(): {
    isRunning: boolean;
    methods: string[];
    stats: any;
  } {
    return {
      isRunning: this.isRunning,
      methods: this.jsonrpcServer.getRegisteredMethods(),
      stats: this.jsonrpcServer.getStatus()
    };
  }

  /**
   * Send a notification to the client
   */
  sendNotification(method: string, params: any): void {
    this.jsonrpcServer.sendNotification(method, params);
  }
}

/**
 * Create and configure ACP server instance
 */
export function createACPServer(): ACPServer {
  const server = new ACPServer();

  // Handle process signals for graceful shutdown
  process.on('SIGTERM', () => {
    console.error('[ACP Server] Received SIGTERM, shutting down gracefully');
    server.stop();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.error('[ACP Server] Received SIGINT, shutting down gracefully');
    server.stop();
    process.exit(0);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('[ACP Server] Uncaught exception:', error);
    server.stop();
    process.exit(1);
  });

  return server;
}