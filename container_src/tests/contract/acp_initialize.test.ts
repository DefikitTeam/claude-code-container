/**
 * Contract test for ACP initialize method
 * Tests stdio JSON-RPC communication for agent initialization
 */

import { describe, it, expect } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { InitializeRequest, InitializeResponse, ACP_ERROR_CODES } from '../../src/types/acp-messages.js';

describe('ACP Initialize Method Contract', () => {
  let agentProcess: ChildProcess;

  // Helper function to send JSON-RPC message and get response
  async function sendACPMessage(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Test timeout - no response received'));
      }, 5000);

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
    // Spawn the container in ACP stdio mode
    agentProcess = spawn('node', ['dist/main.js', '--acp'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ACP_MODE: 'stdio',
        NODE_ENV: 'test'
      }
    });

    // Wait for process to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  afterEach(() => {
    if (agentProcess) {
      agentProcess.kill();
    }
  });

  it('should respond to valid initialize request with agent capabilities', async () => {
    const initRequest: InitializeRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '0.3.1',
        clientCapabilities: {
          editWorkspace: true,
          filesRead: true,
          filesWrite: true
        },
        clientInfo: {
          name: 'Test Client',
          version: '1.0.0'
        }
      }
    };

    const response = await sendACPMessage(initRequest);

    // Verify response structure matches InitializeResponse
    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: expect.stringMatching(/^0\.3\./),
        agentCapabilities: {
          editWorkspace: expect.any(Boolean),
          filesRead: expect.any(Boolean),
          filesWrite: expect.any(Boolean),
          sessionPersistence: expect.any(Boolean),
          streamingUpdates: expect.any(Boolean),
          githubIntegration: expect.any(Boolean)
        },
        agentInfo: {
          name: expect.stringContaining('Claude Code'),
          version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
          description: expect.any(String)
        }
      }
    });

    // Verify agent capabilities
    const capabilities = response.result.agentCapabilities;
    expect(capabilities.editWorkspace).toBe(true);
    expect(capabilities.filesRead).toBe(true);
    expect(capabilities.filesWrite).toBe(true);
    expect(capabilities.sessionPersistence).toBe(true);
    expect(capabilities.streamingUpdates).toBe(true);
    expect(capabilities.githubIntegration).toBe(true);
  });

  it('should handle initialize request with minimal parameters', async () => {
    const initRequest: InitializeRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: {
        protocolVersion: '0.3.1'
      }
    };

    const response = await sendACPMessage(initRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: {
        protocolVersion: '0.3.1',
        agentCapabilities: expect.any(Object),
        agentInfo: expect.any(Object)
      }
    });
  });

  it('should return error for unsupported protocol version', async () => {
    const initRequest = {
      jsonrpc: '2.0',
      id: 3,
      method: 'initialize',
      params: {
        protocolVersion: '999.0.0'
      }
    };

    const response = await sendACPMessage(initRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      error: {
        code: expect.any(Number),
        message: expect.stringContaining('protocol version'),
        data: expect.objectContaining({
          supportedVersion: expect.stringMatching(/^0\.3\./)
        })
      }
    });
  });

  it('should return error for invalid JSON-RPC format', async () => {
    const invalidRequest = {
      // Missing jsonrpc field
      id: 4,
      method: 'initialize',
      params: {
        protocolVersion: '0.3.1'
      }
    };

    const response = await sendACPMessage(invalidRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 4,
      error: {
        code: ACP_ERROR_CODES.INVALID_REQUEST,
        message: expect.stringContaining('Invalid Request')
      }
    });
  });

  it('should return error for missing required parameters', async () => {
    const incompleteRequest = {
      jsonrpc: '2.0',
      id: 5,
      method: 'initialize',
      params: {
        // Missing protocolVersion
        clientInfo: {
          name: 'Test Client',
          version: '1.0.0'
        }
      }
    };

    const response = await sendACPMessage(incompleteRequest);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 5,
      error: {
        code: ACP_ERROR_CODES.INVALID_PARAMS,
        message: expect.stringContaining('protocolVersion')
      }
    });
  });

  it('should handle multiple initialize requests in sequence', async () => {
    // First request
    const request1: InitializeRequest = {
      jsonrpc: '2.0',
      id: 6,
      method: 'initialize',
      params: { protocolVersion: '0.3.1' }
    };

    const response1 = await sendACPMessage(request1);
    expect(response1.id).toBe(6);
    expect(response1.result).toBeDefined();

    // Second request should work too (agent should be re-initializable)
    const request2: InitializeRequest = {
      jsonrpc: '2.0',
      id: 7,
      method: 'initialize',
      params: { protocolVersion: '0.3.1' }
    };

    const response2 = await sendACPMessage(request2);
    expect(response2.id).toBe(7);
    expect(response2.result).toBeDefined();
  });
});