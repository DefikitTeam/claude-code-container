/**
 * Contract test for ACP cancel method
 * Tests operation cancellation and cleanup
 */

import { describe, it, expect } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import {
  CancelRequest,
  CancelResponse,
  SessionNewRequest,
  SessionPromptRequest,
  InitializeRequest,
  ACP_ERROR_CODES
} from '../../src/types/acp-messages.js';

describe('ACP Cancel Method Contract', () => {
  let agentProcess: ChildProcess;
  let sessionId: string;

  async function sendACPMessage(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout - no response received'));
      }, 10000);

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

    // Initialize and create session
    await sendACPMessage({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '0.3.1' }
    });

    const sessionResponse = await sendACPMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'session/new',
      params: { mode: 'development' }
    });

    sessionId = sessionResponse.result.sessionId;
  });

  afterEach(() => {
    if (agentProcess) {
      agentProcess.kill();
    }
  });

  it('should cancel operation for valid session', async () => {
    const cancelRequest: CancelRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'cancel',
      params: {
        sessionId
      }
    };

    const response = await sendACPMessage(cancelRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: {
        cancelled: expect.any(Boolean)
      }
    });

    // Should return true even if no operation was running
    expect(typeof response.result.cancelled).toBe('boolean');
  });

  it('should handle cancel for non-existent session', async () => {
    const cancelRequest: CancelRequest = {
      jsonrpc: '2.0',
      id: 3,
      method: 'cancel',
      params: {
        sessionId: 'non-existent-session'
      }
    };

    const response = await sendACPMessage(cancelRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      error: {
        code: ACP_ERROR_CODES.SESSION_NOT_FOUND,
        message: expect.stringContaining('session')
      }
    });
  });

  it('should validate session ID parameter', async () => {
    const cancelRequest = {
      jsonrpc: '2.0',
      id: 4,
      method: 'cancel',
      params: {
        sessionId: '' // Empty session ID
      }
    };

    const response = await sendACPMessage(cancelRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 4,
      error: {
        code: ACP_ERROR_CODES.INVALID_PARAMS,
        message: expect.stringContaining('sessionId')
      }
    });
  });

  it('should handle missing parameters', async () => {
    const cancelRequest = {
      jsonrpc: '2.0',
      id: 5,
      method: 'cancel',
      params: {
        // Missing sessionId parameter
      }
    };

    const response = await sendACPMessage(cancelRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 5,
      error: {
        code: ACP_ERROR_CODES.INVALID_PARAMS,
        message: expect.stringContaining('sessionId')
      }
    });
  });

  it('should handle cancel during active operation', async () => {
    // Start a long-running operation (in background, don't wait)
    const promptRequest: SessionPromptRequest = {
      jsonrpc: '2.0',
      id: 6,
      method: 'session/prompt',
      params: {
        sessionId,
        content: [
          {
            type: 'text',
            text: 'Please perform a comprehensive analysis of a large codebase (this should take some time).'
          }
        ]
      }
    };

    // Send the prompt (don't wait for response)
    agentProcess.stdin?.write(JSON.stringify(promptRequest) + '\n');

    // Wait a bit for operation to start
    await new Promise(resolve => setTimeout(resolve, 100));

    // Now cancel it
    const cancelRequest: CancelRequest = {
      jsonrpc: '2.0',
      id: 7,
      method: 'cancel',
      params: {
        sessionId
      }
    };

    const response = await sendACPMessage(cancelRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 7,
      result: {
        cancelled: true
      }
    });
  });

  it('should be idempotent (multiple cancels should work)', async () => {
    // First cancel
    const cancelRequest1: CancelRequest = {
      jsonrpc: '2.0',
      id: 8,
      method: 'cancel',
      params: {
        sessionId
      }
    };

    const response1 = await sendACPMessage(cancelRequest1);
    expect(response1.result.cancelled).toBeDefined();

    // Second cancel (should also work)
    const cancelRequest2: CancelRequest = {
      jsonrpc: '2.0',
      id: 9,
      method: 'cancel',
      params: {
        sessionId
      }
    };

    const response2 = await sendACPMessage(cancelRequest2);
    expect(response2.result.cancelled).toBeDefined();
  });

  it('should respond quickly to cancel requests', async () => {
    const startTime = Date.now();

    const cancelRequest: CancelRequest = {
      jsonrpc: '2.0',
      id: 10,
      method: 'cancel',
      params: {
        sessionId
      }
    };

    const response = await sendACPMessage(cancelRequest);
    const endTime = Date.now();

    expect(response.result.cancelled).toBeDefined();

    // Cancel should respond within 1 second
    expect(endTime - startTime).toBeLessThan(1000);
  });
});