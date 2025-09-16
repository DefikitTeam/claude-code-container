/**
 * Contract test for ACP session/load method
 * Tests session restoration and state persistence
 */

import { describe, it, expect } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import {
  SessionLoadRequest,
  SessionLoadResponse,
  SessionNewRequest,
  InitializeRequest,
  ACP_ERROR_CODES
} from '../../src/types/acp-messages.js';

describe('ACP Session/Load Method Contract', () => {
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

  it('should load existing session without history', async () => {
    const loadRequest: SessionLoadRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'session/load',
      params: {
        sessionId,
        includeHistory: false
      }
    };

    const response = await sendACPMessage(loadRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: {
        sessionInfo: {
          sessionId,
          state: expect.stringMatching(/^(active|paused|completed|error)$/),
          createdAt: expect.any(Number),
          lastActiveAt: expect.any(Number)
        },
        historyAvailable: expect.any(Boolean)
      }
    });

    expect(response.result.sessionInfo.createdAt).toBeGreaterThan(0);
    expect(response.result.sessionInfo.lastActiveAt).toBeGreaterThanOrEqual(response.result.sessionInfo.createdAt);
  });

  it('should load existing session with history', async () => {
    const loadRequest: SessionLoadRequest = {
      jsonrpc: '2.0',
      id: 3,
      method: 'session/load',
      params: {
        sessionId,
        includeHistory: true
      }
    };

    const response = await sendACPMessage(loadRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      result: {
        sessionInfo: {
          sessionId,
          state: expect.any(String),
          createdAt: expect.any(Number),
          lastActiveAt: expect.any(Number)
        },
        historyAvailable: expect.any(Boolean)
      }
    });
  });

  it('should return error for non-existent session', async () => {
    const loadRequest: SessionLoadRequest = {
      jsonrpc: '2.0',
      id: 4,
      method: 'session/load',
      params: {
        sessionId: 'non-existent-session-id'
      }
    };

    const response = await sendACPMessage(loadRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 4,
      error: {
        code: ACP_ERROR_CODES.SESSION_NOT_FOUND,
        message: expect.stringContaining('session')
      }
    });
  });

  it('should handle session load with default parameters', async () => {
    const loadRequest: SessionLoadRequest = {
      jsonrpc: '2.0',
      id: 5,
      method: 'session/load',
      params: {
        sessionId
        // includeHistory not specified (should default to false)
      }
    };

    const response = await sendACPMessage(loadRequest);

    expect(response.result).toBeDefined();
    expect(response.result.sessionInfo.sessionId).toBe(sessionId);
  });

  it('should validate session ID format', async () => {
    const loadRequest = {
      jsonrpc: '2.0',
      id: 6,
      method: 'session/load',
      params: {
        sessionId: '' // Empty session ID
      }
    };

    const response = await sendACPMessage(loadRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 6,
      error: {
        code: ACP_ERROR_CODES.INVALID_PARAMS,
        message: expect.stringContaining('sessionId')
      }
    });
  });
});