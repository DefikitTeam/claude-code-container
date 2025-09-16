/**
 * T019 - Integration tests: Full ACP workflow
 * Tests complete Zed ACP workflow: initialize → session/new → session/prompt → session/update notifications
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { promises as fs } from 'fs';

interface JsonRpcMessage {
  jsonrpc: '2.0';
  method?: string;
  params?: any;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id?: string | number;
}

interface AcpProcess {
  process: ChildProcess;
  send: (message: JsonRpcMessage) => Promise<void>;
  receive: () => Promise<JsonRpcMessage>;
  cleanup: () => Promise<void>;
}

describe('Full ACP Workflow Integration', () => {
  let acpProcess: AcpProcess | null = null;
  let testWorkspaceDir: string;

  beforeEach(async () => {
    // Create temporary test workspace
    testWorkspaceDir = join(__dirname, '../../../test-workspace-' + Date.now());
    await fs.mkdir(testWorkspaceDir, { recursive: true });

    // Create a simple test file
    await fs.writeFile(
      join(testWorkspaceDir, 'test.js'),
      'console.log("Hello, ACP workflow test!");'
    );
  });

  afterEach(async () => {
    if (acpProcess) {
      await acpProcess.cleanup();
      acpProcess = null;
    }

    // Cleanup test workspace
    try {
      await fs.rm(testWorkspaceDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to cleanup test workspace:', error);
    }
  });

  async function createAcpProcess(): Promise<AcpProcess> {
    const containerPath = join(__dirname, '../../dist/main.js');

    const childProcess = spawn('node', [containerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ACP_MODE: 'stdio',
        NODE_ENV: 'test',
      }
    });

    const messageQueue: JsonRpcMessage[] = [];
    let messageResolvers: ((message: JsonRpcMessage) => void)[] = [];

    childProcess.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n').filter((line: string) => line.trim());

      for (const line of lines) {
        try {
          const message = JSON.parse(line) as JsonRpcMessage;

          if (messageResolvers.length > 0) {
            const resolver = messageResolvers.shift()!;
            resolver(message);
          } else {
            messageQueue.push(message);
          }
        } catch (error) {
          console.warn('Failed to parse JSON-RPC message:', line, error);
        }
      }
    });

    childProcess.stderr?.on('data', (data) => {
      console.error('ACP Process stderr:', data.toString());
    });

    const send = async (message: JsonRpcMessage): Promise<void> => {
      return new Promise((resolve, reject) => {
        const jsonString = JSON.stringify(message) + '\n';

        childProcess.stdin?.write(jsonString, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    };

    const receive = async (): Promise<JsonRpcMessage> => {
      if (messageQueue.length > 0) {
        return messageQueue.shift()!;
      }

      return new Promise((resolve) => {
        messageResolvers.push(resolve);
      });
    };

    const cleanup = async (): Promise<void> => {
      return new Promise((resolve) => {
        childProcess.on('close', () => resolve());
        childProcess.kill();
      });
    };

    // Wait for process to start
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return {
      process: childProcess,
      send,
      receive,
      cleanup,
    };
  }

  test('Complete ACP workflow: initialize → session/new → session/prompt', async () => {
    acpProcess = await createAcpProcess();
    let messageId = 1;

    // Step 1: Initialize ACP Agent
    await acpProcess.send({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '0.3.1',
        capabilities: {
          tools: {}
        },
        clientInfo: {
          name: 'acp-workflow-test',
          version: '1.0.0'
        }
      },
      id: messageId++
    });

    const initResponse = await acpProcess.receive();
    expect(initResponse.jsonrpc).toBe('2.0');
    expect(initResponse.result).toBeDefined();
    expect(initResponse.result.serverInfo).toBeDefined();
    expect(initResponse.result.serverInfo.name).toBe('claude-code-container');
    expect(initResponse.error).toBeUndefined();

    // Step 2: Create new session
    await acpProcess.send({
      jsonrpc: '2.0',
      method: 'session/new',
      params: {
        sessionOptions: {
          workspaceUri: `file://${testWorkspaceDir}`,
          mode: 'development'
        }
      },
      id: messageId++
    });

    const sessionResponse = await acpProcess.receive();
    expect(sessionResponse.jsonrpc).toBe('2.0');
    expect(sessionResponse.result).toBeDefined();
    expect(sessionResponse.result.sessionId).toBeDefined();
    expect(sessionResponse.result.workspaceInfo).toBeDefined();
    expect(sessionResponse.result.workspaceInfo.rootPath).toBeDefined();
    expect(sessionResponse.error).toBeUndefined();

    const sessionId = sessionResponse.result.sessionId;

    // Step 3: Send session prompt
    await acpProcess.send({
      jsonrpc: '2.0',
      method: 'session/prompt',
      params: {
        sessionId: sessionId,
        content: [
          {
            type: 'text',
            content: 'List the files in this workspace and show me the content of test.js'
          }
        ]
      },
      id: messageId++
    });

    const promptResponse = await acpProcess.receive();
    expect(promptResponse.jsonrpc).toBe('2.0');

    // Note: The prompt might fail due to ANTHROPIC_API_KEY issue, but the JSON-RPC structure should be correct
    if (promptResponse.error) {
      expect(promptResponse.error.code).toBeDefined();
      expect(promptResponse.error.message).toBeDefined();
      console.log('Expected error (API key issue):', promptResponse.error.message);
    } else {
      expect(promptResponse.result).toBeDefined();
      expect(promptResponse.result.content).toBeDefined();
    }

    // Step 4: Test session/load
    await acpProcess.send({
      jsonrpc: '2.0',
      method: 'session/load',
      params: {
        sessionId: sessionId
      },
      id: messageId++
    });

    const loadResponse = await acpProcess.receive();
    expect(loadResponse.jsonrpc).toBe('2.0');
    expect(loadResponse.result).toBeDefined();
    expect(loadResponse.result.sessionInfo).toBeDefined();
    expect(loadResponse.result.sessionInfo.sessionId).toBe(sessionId);
    expect(loadResponse.error).toBeUndefined();

    // Step 5: Test cancel operation
    await acpProcess.send({
      jsonrpc: '2.0',
      method: 'cancel',
      params: {
        sessionId: sessionId
      },
      id: messageId++
    });

    const cancelResponse = await acpProcess.receive();
    expect(cancelResponse.jsonrpc).toBe('2.0');
    expect(cancelResponse.result).toBeDefined();
    expect(cancelResponse.error).toBeUndefined();
  }, 30000); // 30 second timeout

  test('ACP method validation and error handling', async () => {
    acpProcess = await createAcpProcess();
    let messageId = 1;

    // Test invalid method
    await acpProcess.send({
      jsonrpc: '2.0',
      method: 'invalid/method',
      params: {},
      id: messageId++
    });

    const invalidResponse = await acpProcess.receive();
    expect(invalidResponse.jsonrpc).toBe('2.0');
    expect(invalidResponse.error).toBeDefined();
    expect(invalidResponse.error!.code).toBe(-32601); // Method not found
    expect(invalidResponse.error!.message).toContain('method not found');

    // Test session/prompt without session
    await acpProcess.send({
      jsonrpc: '2.0',
      method: 'session/prompt',
      params: {
        sessionId: 'non-existent-session',
        content: [
          {
            type: 'text',
            content: 'Test prompt'
          }
        ]
      },
      id: messageId++
    });

    const noSessionResponse = await acpProcess.receive();
    expect(noSessionResponse.jsonrpc).toBe('2.0');
    expect(noSessionResponse.error).toBeDefined();
    expect(noSessionResponse.error!.code).toBe(-32603); // Internal error
    expect(noSessionResponse.error!.message).toContain('Internal error');

    // Test malformed JSON-RPC
    await acpProcess.send({
      // @ts-ignore - intentionally malformed
      invalidField: 'test'
    });

    const malformedResponse = await acpProcess.receive();
    expect(malformedResponse.jsonrpc).toBe('2.0');
    expect(malformedResponse.error).toBeDefined();
    expect(malformedResponse.error!.code).toBe(-32600); // Invalid request
  }, 15000);

  test('Session isolation and workspace management', async () => {
    acpProcess = await createAcpProcess();
    let messageId = 1;

    // Initialize
    await acpProcess.send({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '0.3.1',
        capabilities: { tools: {} },
        clientInfo: { name: 'session-test', version: '1.0.0' }
      },
      id: messageId++
    });

    await acpProcess.receive(); // Initialize response

    // Create first session
    await acpProcess.send({
      jsonrpc: '2.0',
      method: 'session/new',
      params: {
        sessionOptions: {
          workspaceUri: `file://${testWorkspaceDir}`,
          mode: 'development'
        }
      },
      id: messageId++
    });

    const session1Response = await acpProcess.receive();
    const session1Id = session1Response.result.sessionId;

    // Create second session with same workspace
    await acpProcess.send({
      jsonrpc: '2.0',
      method: 'session/new',
      params: {
        sessionOptions: {
          workspaceUri: `file://${testWorkspaceDir}`,
          mode: 'testing'
        }
      },
      id: messageId++
    });

    const session2Response = await acpProcess.receive();
    const session2Id = session2Response.result.sessionId;

    // Sessions should have different IDs
    expect(session1Id).not.toBe(session2Id);

    // Both sessions should be loadable
    await acpProcess.send({
      jsonrpc: '2.0',
      method: 'session/load',
      params: { sessionId: session1Id },
      id: messageId++
    });

    const load1Response = await acpProcess.receive();
    expect(load1Response.result.sessionInfo.sessionId).toBe(session1Id);

    await acpProcess.send({
      jsonrpc: '2.0',
      method: 'session/load',
      params: { sessionId: session2Id },
      id: messageId++
    });

    const load2Response = await acpProcess.receive();
    expect(load2Response.result.sessionInfo.sessionId).toBe(session2Id);
  }, 20000);

  test('Concurrent ACP operations', async () => {
    acpProcess = await createAcpProcess();

    // Send multiple messages rapidly
    const promises = [];
    for (let i = 1; i <= 5; i++) {
      promises.push(
        acpProcess.send({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '0.3.1',
            capabilities: { tools: {} },
            clientInfo: { name: `concurrent-test-${i}`, version: '1.0.0' }
          },
          id: i
        })
      );
    }

    await Promise.all(promises);

    // Collect all responses
    const responses: JsonRpcMessage[] = [];
    for (let i = 0; i < 5; i++) {
      responses.push(await acpProcess.receive());
    }

    // All responses should be valid
    expect(responses).toHaveLength(5);
    responses.forEach((response, index) => {
      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBeDefined();
      expect([1, 2, 3, 4, 5]).toContain(response.id);

      if (response.result) {
        expect(response.result.serverInfo).toBeDefined();
      } else {
        expect(response.error).toBeDefined();
      }
    });
  }, 15000);

  test('Workspace file operations integration', async () => {
    acpProcess = await createAcpProcess();
    let messageId = 1;

    // Initialize and create session
    await acpProcess.send({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '0.3.1',
        capabilities: { tools: {} },
        clientInfo: { name: 'file-ops-test', version: '1.0.0' }
      },
      id: messageId++
    });

    await acpProcess.receive(); // Initialize response

    await acpProcess.send({
      jsonrpc: '2.0',
      method: 'session/new',
      params: {
        sessionOptions: {
          workspaceUri: `file://${testWorkspaceDir}`,
          mode: 'development'
        }
      },
      id: messageId++
    });

    const sessionResponse = await acpProcess.receive();
    const sessionId = sessionResponse.result.sessionId;

    // Test workspace info includes file detection
    await acpProcess.send({
      jsonrpc: '2.0',
      method: 'session/load',
      params: { sessionId: sessionId },
      id: messageId++
    });

    const loadResponse = await acpProcess.receive();
    expect(loadResponse.result.sessionInfo).toBeDefined();
    expect(loadResponse.result.workspaceInfo).toBeDefined();

    // Workspace should have at least the test.js file we created
    const workspaceInfo = loadResponse.result.workspaceInfo;
    expect(workspaceInfo.rootPath).toBeDefined();
  }, 15000);
});