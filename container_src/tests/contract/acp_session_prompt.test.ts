/**
 * Contract test for ACP session/prompt method
 * Tests content processing and streaming updates
 */

import { describe, it, expect } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import {
  SessionPromptRequest,
  SessionPromptResponse,
  SessionNewRequest,
  InitializeRequest,
  SessionUpdateNotification,
  ContentBlock,
  ACP_ERROR_CODES
} from '../../src/types/acp-messages.js';

describe('ACP Session/Prompt Method Contract', () => {
  let agentProcess: ChildProcess;
  let sessionId: string;

  async function sendACPMessage(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout - no response received'));
      }, 30000); // Longer timeout for prompt processing

      agentProcess.stdout?.once('data', (data) => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(data.toString().trim());
          resolve(response);
        } catch (error) {
          reject(new Error(`Failed to parse JSON response: ${error}`));
        }
      });

      agentProcess.stderr?.once('data', (data) => {
        clearTimeout(timeout);
        reject(new Error(`Agent process error: ${data.toString()}`));
      });

      agentProcess.stdin?.write(JSON.stringify(message) + '\n');
    });
  }

  // Helper to collect streaming updates
  async function sendACPMessageWithUpdates(message: any): Promise<{ response: any, updates: any[] }> {
    return new Promise((resolve, reject) => {
      const updates: any[] = [];
      let finalResponse: any = null;

      const timeout = setTimeout(() => {
        reject(new Error('Test timeout - no final response received'));
      }, 30000);

      const dataHandler = (data: Buffer) => {
        try {
          const lines = data.toString().split('\n').filter(line => line.trim());
          for (const line of lines) {
            const parsed = JSON.parse(line);

            if (parsed.method === 'session/update') {
              updates.push(parsed);
            } else if (parsed.id === message.id) {
              finalResponse = parsed;
              clearTimeout(timeout);
              agentProcess.stdout?.removeListener('data', dataHandler);
              resolve({ response: finalResponse, updates });
            }
          }
        } catch (error) {
          clearTimeout(timeout);
          agentProcess.stdout?.removeListener('data', dataHandler);
          reject(new Error(`Failed to parse JSON: ${error}`));
        }
      };

      agentProcess.stdout?.on('data', dataHandler);

      agentProcess.stderr?.once('data', (data) => {
        clearTimeout(timeout);
        agentProcess.stdout?.removeListener('data', dataHandler);
        reject(new Error(`Agent process error: ${data.toString()}`));
      });

      agentProcess.stdin?.write(JSON.stringify(message) + '\n');
    });
  }

  beforeEach(async () => {
    agentProcess = spawn('node', ['dist/main.js', '--acp'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ACP_MODE: 'stdio',
        NODE_ENV: 'test'
      }
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    // Initialize the agent
    const initRequest: InitializeRequest = {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '0.3.1' }
    };
    await sendACPMessage(initRequest);

    // Create a session
    const sessionRequest: SessionNewRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'session/new',
      params: { mode: 'development' }
    };

    const sessionResponse = await sendACPMessage(sessionRequest);
    sessionId = sessionResponse.result.sessionId;
  });

  afterEach(() => {
    if (agentProcess) {
      agentProcess.kill();
    }
  });

  it('should process simple text prompt', async () => {
    const content: ContentBlock[] = [
      {
        type: 'text',
        content: 'Hello, can you help me create a simple JavaScript function?'
      }
    ];

    const promptRequest: SessionPromptRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: {
        sessionId,
        content
      }
    };

    const { response, updates } = await sendACPMessageWithUpdates(promptRequest);

    // Verify final response
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: {
        stopReason: expect.stringMatching(/^(completed|cancelled|error|timeout)$/),
        usage: expect.objectContaining({
          inputTokens: expect.any(Number),
          outputTokens: expect.any(Number)
        })
      }
    });

    // Verify streaming updates were sent
    expect(updates.length).toBeGreaterThan(0);

    // Check update structure
    updates.forEach(update => {
      expect(update).toMatchObject({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          status: expect.stringMatching(/^(thinking|working|completed|error)$/)
        }
      });
    });
  });

  it('should handle prompts with context files', async () => {
    const content: ContentBlock[] = [
      {
        type: 'text',
        content: 'Please analyze the package.json file and suggest improvements.'
      }
    ];

    const promptRequest: SessionPromptRequest = {
      jsonrpc: '2.0',
      id: 3,
      method: 'session/prompt',
      params: {
        sessionId,
        content,
        contextFiles: ['package.json']
      }
    };

    const { response } = await sendACPMessageWithUpdates(promptRequest);

    expect(response.result).toMatchObject({
      stopReason: expect.any(String),
      usage: expect.any(Object)
    });

    if (response.result.stopReason === 'completed') {
      expect(response.result.usage.inputTokens).toBeGreaterThan(0);
      expect(response.result.usage.outputTokens).toBeGreaterThan(0);
    }
  });

  it('should handle prompts with agent context', async () => {
    const content: ContentBlock[] = [
      {
        type: 'text',
        content: 'Fix the authentication issue in the login system.'
      }
    ];

    const promptRequest: SessionPromptRequest = {
      jsonrpc: '2.0',
      id: 4,
      method: 'session/prompt',
      params: {
        sessionId,
        content,
        agentContext: {
          requestingAgent: 'SecurityBot-v2.1',
          priority: 'high',
          userRequest: 'Users are reporting login failures'
        }
      }
    };

    const { response, updates } = await sendACPMessageWithUpdates(promptRequest);

    expect(response.result.stopReason).toBeDefined();

    // Should have received thinking and working updates
    const statuses = updates.map(u => u.params.status);
    expect(statuses).toContain('thinking');
  });

  it('should handle file content in prompts', async () => {
    const content: ContentBlock[] = [
      {
        type: 'text',
        content: 'Please review this code for potential issues:'
      },
      {
        type: 'file',
        content: 'function login(username, password) {\n  return username === "admin" && password === "password";\n}',
        metadata: {
          filename: 'auth.js',
          language: 'javascript'
        }
      }
    ];

    const promptRequest: SessionPromptRequest = {
      jsonrpc: '2.0',
      id: 5,
      method: 'session/prompt',
      params: {
        sessionId,
        content
      }
    };

    const { response } = await sendACPMessageWithUpdates(promptRequest);

    expect(response.result).toBeDefined();
    expect(response.result.stopReason).toBe('completed');
  });

  it('should return error for invalid session ID', async () => {
    const promptRequest: SessionPromptRequest = {
      jsonrpc: '2.0',
      id: 6,
      method: 'session/prompt',
      params: {
        sessionId: 'invalid-session-id',
        content: [
          { type: 'text', content: 'Test prompt' }
        ]
      }
    };

    const response = await sendACPMessage(promptRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 6,
      error: {
        code: ACP_ERROR_CODES.SESSION_NOT_FOUND,
        message: expect.stringContaining('session')
      }
    });
  });

  it('should return error for empty content', async () => {
    const promptRequest: SessionPromptRequest = {
      jsonrpc: '2.0',
      id: 7,
      method: 'session/prompt',
      params: {
        sessionId,
        content: [] // Empty content
      }
    };

    const response = await sendACPMessage(promptRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 7,
      error: {
        code: ACP_ERROR_CODES.INVALID_PARAMS,
        message: expect.stringContaining('content')
      }
    });
  });

  it('should handle GitHub operations in response', async () => {
    const content: ContentBlock[] = [
      {
        type: 'text',
        content: 'Create a new README.md file with project description.'
      }
    ];

    const promptRequest: SessionPromptRequest = {
      jsonrpc: '2.0',
      id: 8,
      method: 'session/prompt',
      params: {
        sessionId,
        content,
        agentContext: {
          priority: 'medium'
        }
      }
    };

    const { response } = await sendACPMessageWithUpdates(promptRequest);

    if (response.result.stopReason === 'completed' && response.result.githubOperations) {
      expect(response.result.githubOperations).toMatchObject({
        filesModified: expect.any(Array)
      });

      if (response.result.githubOperations.pullRequestCreated) {
        expect(response.result.githubOperations.pullRequestCreated).toMatchObject({
          url: expect.stringMatching(/^https:\/\/github\.com\/.+\/pull\/\d+$/),
          number: expect.any(Number),
          title: expect.any(String)
        });
      }
    }
  });

  it('should provide progress updates during long operations', async () => {
    const content: ContentBlock[] = [
      {
        type: 'text',
        content: 'Please analyze the entire codebase and provide a comprehensive architecture review.'
      }
    ];

    const promptRequest: SessionPromptRequest = {
      jsonrpc: '2.0',
      id: 9,
      method: 'session/prompt',
      params: {
        sessionId,
        content
      }
    };

    const { updates } = await sendACPMessageWithUpdates(promptRequest);

    // Should have received multiple progress updates
    expect(updates.length).toBeGreaterThan(1);

    // Check for progress information
    const progressUpdates = updates.filter(u => u.params.progress);
    if (progressUpdates.length > 0) {
      progressUpdates.forEach(update => {
        expect(update.params.progress).toMatchObject({
          current: expect.any(Number),
          total: expect.any(Number),
          message: expect.any(String)
        });
      });
    }
  });

  it('should validate content block structure', async () => {
    const invalidContent = [
      {
        // Missing type field
        content: 'This is invalid'
      }
    ];

    const promptRequest = {
      jsonrpc: '2.0',
      id: 10,
      method: 'session/prompt',
      params: {
        sessionId,
        content: invalidContent
      }
    };

    const response = await sendACPMessage(promptRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 10,
      error: {
        code: ACP_ERROR_CODES.INVALID_PARAMS,
        message: expect.stringContaining('content')
      }
    });
  });
});