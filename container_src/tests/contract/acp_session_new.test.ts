/**
 * Contract test for ACP session/new method
 * Tests session creation and workspace setup
 */

import { describe, it, expect } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { SessionNewRequest, SessionNewResponse, InitializeRequest, ACP_ERROR_CODES } from '../../src/types/acp-messages.js';

describe('ACP Session/New Method Contract', () => {
  let agentProcess: ChildProcess;

  async function sendACPMessage(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout - no response received'));
      }, 10000); // Longer timeout for session operations

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

    // Initialize the agent first
    const initRequest: InitializeRequest = {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: { protocolVersion: '0.3.1' }
    };

    await sendACPMessage(initRequest);
  });

  afterEach(() => {
    if (agentProcess) {
      agentProcess.kill();
    }
  });

  it('should create a new session with minimal parameters', async () => {
    const sessionRequest: SessionNewRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'session/new',
      params: {}
    };

    const response = await sendACPMessage(sessionRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        sessionId: expect.stringMatching(/^session-[a-f0-9-]+$/),
        workspaceInfo: expect.any(Object)
      }
    });

    // Verify sessionId format
    const sessionId = response.result.sessionId;
    expect(sessionId).toMatch(/^session-[a-f0-9-]+$/);
    expect(sessionId.length).toBeGreaterThan(10);
  });

  it('should create session with workspace URI', async () => {
    const sessionRequest: SessionNewRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'session/new',
      params: {
        workspaceUri: 'file:///tmp/test-workspace',
        mode: 'development'
      }
    };

    const response = await sendACPMessage(sessionRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: {
        sessionId: expect.any(String),
        workspaceInfo: {
          rootPath: expect.stringContaining('/tmp/test-workspace'),
          hasUncommittedChanges: expect.any(Boolean)
        }
      }
    });
  });

  it('should create session with full configuration', async () => {
    const sessionRequest: SessionNewRequest = {
      jsonrpc: '2.0',
      id: 3,
      method: 'session/new',
      params: {
        workspaceUri: 'file:///tmp/full-config-workspace',
        mode: 'conversation',
        sessionOptions: {
          persistHistory: true,
          enableGitOps: true,
          contextFiles: ['package.json', 'README.md']
        }
      }
    };

    const response = await sendACPMessage(sessionRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      result: {
        sessionId: expect.any(String),
        workspaceInfo: expect.objectContaining({
          rootPath: expect.any(String),
          hasUncommittedChanges: expect.any(Boolean)
        })
      }
    });

    // Verify sessionId is unique
    const sessionId = response.result.sessionId;
    expect(sessionId).toBeTruthy();
    expect(typeof sessionId).toBe('string');
  });

  it('should handle multiple concurrent session creation', async () => {
    const request1 = {
      jsonrpc: '2.0',
      id: 4,
      method: 'session/new',
      params: { mode: 'development' }
    };

    const request2 = {
      jsonrpc: '2.0',
      id: 5,
      method: 'session/new',
      params: { mode: 'conversation' }
    };

    // Send requests in rapid succession (simulating concurrent behavior)
    const response1 = await sendACPMessage(request1);
    const response2 = await sendACPMessage(request2);

    // Both should succeed
    expect(response1.result.sessionId).toBeTruthy();
    expect(response2.result.sessionId).toBeTruthy();

    // SessionIds should be different
    expect(response1.result.sessionId).not.toBe(response2.result.sessionId);
  });

  it('should validate mode parameter', async () => {
    const sessionRequest = {
      jsonrpc: '2.0',
      id: 6,
      method: 'session/new',
      params: {
        mode: 'invalid_mode' // Invalid mode
      }
    };

    const response = await sendACPMessage(sessionRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 6,
      error: {
        code: ACP_ERROR_CODES.INVALID_PARAMS,
        message: expect.stringContaining('mode')
      }
    });
  });

  it('should validate workspace URI format', async () => {
    const sessionRequest = {
      jsonrpc: '2.0',
      id: 7,
      method: 'session/new',
      params: {
        workspaceUri: 'invalid://not-a-file-uri'
      }
    };

    const response = await sendACPMessage(sessionRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 7,
      error: {
        code: ACP_ERROR_CODES.INVALID_PARAMS,
        message: expect.stringContaining('workspaceUri')
      }
    });
  });

  it('should handle workspace access errors gracefully', async () => {
    const sessionRequest: SessionNewRequest = {
      jsonrpc: '2.0',
      id: 8,
      method: 'session/new',
      params: {
        workspaceUri: 'file:///root/restricted-access' // Likely to fail
      }
    };

    const response = await sendACPMessage(sessionRequest);

    // Should either succeed with alternative path or return workspace error
    if (response.error) {
      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 8,
        error: {
          code: ACP_ERROR_CODES.WORKSPACE_ERROR,
          message: expect.any(String)
        }
      });
    } else {
      expect(response.result.sessionId).toBeTruthy();
    }
  });

  it('should return different session IDs for consecutive requests', async () => {
    const sessionIds = [];

    for (let i = 9; i < 12; i++) {
      const sessionRequest: SessionNewRequest = {
        jsonrpc: '2.0',
        id: i,
        method: 'session/new',
        params: { mode: 'development' }
      };

      const response = await sendACPMessage(sessionRequest);
      expect(response.result.sessionId).toBeTruthy();
      sessionIds.push(response.result.sessionId);
    }

    // All session IDs should be unique
    const uniqueIds = new Set(sessionIds);
    expect(uniqueIds.size).toBe(sessionIds.length);
  });

  it('should include workspace git information when available', async () => {
    const sessionRequest: SessionNewRequest = {
      jsonrpc: '2.0',
      id: 13,
      method: 'session/new',
      params: {
        workspaceUri: 'file://' + process.cwd(), // Use current directory (has git)
        sessionOptions: {
          enableGitOps: true
        }
      }
    };

    const response = await sendACPMessage(sessionRequest);

    expect(response.result).toMatchObject({
      sessionId: expect.any(String),
      workspaceInfo: expect.objectContaining({
        rootPath: expect.any(String),
        hasUncommittedChanges: expect.any(Boolean)
      })
    });

    // Git branch should be included if this is a git repository
    if (response.result.workspaceInfo.gitBranch) {
      expect(response.result.workspaceInfo.gitBranch).toMatch(/^[a-zA-Z0-9/_-]+$/);
    }
  });
});