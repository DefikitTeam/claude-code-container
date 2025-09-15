#!/usr/bin/env node
/**
 * Simple ACP Example Agent
 *
 * This is a minimal example of how to implement an ACP agent
 * that can connect to Zed or other ACP-compatible editors.
 */

import { AgentSideConnection } from '@zed-industries/agent-client-protocol';

class SimpleACPAgent {
  private connection: AgentSideConnection;

  constructor() {
    this.connection = new AgentSideConnection();
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Handle initialization
    this.connection.onInitialize(async (params) => {
      console.log('[SIMPLE-AGENT] Initialized with client:', params.clientInfo);

      return {
        capabilities: {
          sessionManagement: true,
          codeGeneration: true,
          fileOperations: true
        },
        serverInfo: {
          name: 'simple-acp-agent',
          version: '1.0.0'
        }
      };
    });

    // Handle session creation
    this.connection.onCreateSession(async (params) => {
      const sessionId = `session-${Date.now()}`;

      console.log('[SIMPLE-AGENT] Created session:', sessionId);

      return {
        sessionId,
        capabilities: ['echo', 'greet', 'analyze']
      };
    });

    // Handle task execution
    this.connection.onExecuteTask(async (params) => {
      console.log('[SIMPLE-AGENT] Executing task:', params.task.type, 'in session:', params.sessionId);

      switch (params.task.type) {
        case 'echo':
          return {
            type: 'echo_result',
            message: `Echo: ${params.task.data.message || 'Hello from Simple ACP Agent!'}`
          };

        case 'greet':
          return {
            type: 'greeting_result',
            message: `Hello ${params.task.data.name || 'User'}! Welcome to the Simple ACP Agent.`
          };

        case 'analyze':
          return {
            type: 'analysis_result',
            analysis: `Analyzing: ${params.task.data.content || 'No content provided'}`,
            suggestions: [
              'Consider adding more documentation',
              'Add error handling',
              'Implement unit tests'
            ]
          };

        default:
          throw new Error(`Unknown task type: ${params.task.type}`);
      }
    });

    // Handle file operations (read-only for this example)
    this.connection.onReadFile(async (params) => {
      // In a real implementation, you'd read from the actual filesystem
      return {
        content: `// Example file content for: ${params.path}\n// This is a mock response from Simple ACP Agent\n`
      };
    });

    // Handle session cleanup
    this.connection.onDestroySession(async (params) => {
      console.log('[SIMPLE-AGENT] Destroyed session:', params.sessionId);
      return { success: true };
    });
  }

  public start() {
    console.log('[SIMPLE-AGENT] Simple ACP Agent starting...');
    this.connection.listen();
    console.log('[SIMPLE-AGENT] Agent is ready for connections (stdio mode)');
    console.log('[SIMPLE-AGENT] Try connecting from Zed or another ACP client!');
  }
}

// Start the agent if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const agent = new SimpleACPAgent();
  agent.start();
}

export default SimpleACPAgent;