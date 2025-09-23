#!/usr/bin/env node

/**
 * LumiLink-BE Mock Agent
 * Simulates LumiLink-BE agent behavior for testing ACP communication with Claude Code containers
 */

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

class LumiLinkBEMockAgent {
  constructor(config) {
    this.config = config;
    this.sessionId = null;
    this.acpConnection = null;
    this.messageQueue = [];
    this.responseHandlers = new Map();
  }

  async initialize() {
    console.log('🚀 Initializing LumiLink-BE Mock Agent...');

    // Start Claude Code container process
    await this.startClaudeCodeContainer();

    // Establish ACP connection
    await this.establishACPConnection();

    console.log('✅ LumiLink-BE Mock Agent initialized successfully');
  }

  async startClaudeCodeContainer() {
    console.log('🐳 Starting Claude Code container...');

    // Start the container process
    this.containerProcess = spawn('node', ['container_src/dist/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'test-key',
      },
    });

    // Set up process communication
    this.containerProcess.stdout.on('data', (data) => {
      this.handleContainerMessage(data.toString());
    });

    this.containerProcess.stderr.on('data', (data) => {
      console.error('Container stderr:', data.toString());
    });

    this.containerProcess.on('close', (code) => {
      console.log(`Container process exited with code ${code}`);
    });

    // Wait a bit for container to start
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log('✅ Claude Code container started');
  }

  async establishACPConnection() {
    console.log('🔗 Establishing ACP connection...');

    const initMessage = {
      jsonrpc: '2.0',
      id: 'init-' + randomUUID(),
      method: 'initialize',
      params: {
        clientCapabilities: this.config.capabilities,
        agentId: this.config.agentId,
        protocolVersion: this.config.acpConfig.protocolVersion,
      },
    };

    await this.sendMessage(initMessage);
    console.log('✅ ACP connection established');
  }

  async sendMessage(message) {
    const messageStr = JSON.stringify(message) + '\n';
    this.containerProcess.stdin.write(messageStr);

    // Log the message
    await this.logMessage('SENT', message);
  }

  handleContainerMessage(data) {
    const lines = data.trim().split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line);
        this.processReceivedMessage(message);
      } catch (error) {
        console.error('Failed to parse container message:', error);
        console.error('Raw data:', line);
      }
    }
  }

  async processReceivedMessage(message) {
    await this.logMessage('RECEIVED', message);

    // Handle different message types
    if (message.id && this.responseHandlers.has(message.id)) {
      const handler = this.responseHandlers.get(message.id);
      handler(message);
      this.responseHandlers.delete(message.id);
    } else if (message.method) {
      // Handle notifications/requests from container
      await this.handleContainerRequest(message);
    }
  }

  async handleContainerRequest(message) {
    console.log(`📥 Handling container request: ${message.method}`);

    switch (message.method) {
      case 'session/started':
        this.sessionId = message.params?.sessionId;
        console.log(`🎯 Session started: ${this.sessionId}`);
        break;
      case 'task/progress':
        console.log(`📊 Task progress: ${message.params?.progress}%`);
        break;
      case 'task/completed':
        console.log(`✅ Task completed: ${message.params?.result}`);
        break;
      case 'error':
        console.error(`❌ Container error: ${message.params?.message}`);
        break;
    }
  }

  async logMessage(direction, message) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      direction,
      message,
    };

    const logPath = path.join(
      'test',
      'agent-communication',
      'logs',
      'lumilink-be.log',
    );
    await fs
      .appendFile(logPath, JSON.stringify(logEntry) + '\n')
      .catch(() => {});
  }

  // Test scenarios
  async runBasicConnectionTest() {
    console.log('\n🧪 Running Basic Connection Test...');

    const testId = 'test-' + randomUUID();
    const message = {
      jsonrpc: '2.0',
      id: testId,
      method: 'ping',
      params: { timestamp: Date.now() },
    };

    return new Promise((resolve) => {
      this.responseHandlers.set(testId, (response) => {
        console.log('✅ Basic connection test passed');
        resolve(response);
      });

      this.sendMessage(message);

      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.responseHandlers.has(testId)) {
          this.responseHandlers.delete(testId);
          console.log('❌ Basic connection test timed out');
          resolve(null);
        }
      }, 5000);
    });
  }

  async runCodeAnalysisTest() {
    console.log('\n🧪 Running Code Analysis Test...');

    const testId = 'analysis-' + randomUUID();
    const message = {
      jsonrpc: '2.0',
      id: testId,
      method: 'session/new',
      params: {
        sessionId: 'analysis-session-' + randomUUID(),
        mode: 'code-analysis',
      },
    };

    return new Promise((resolve) => {
      this.responseHandlers.set(testId, async (response) => {
        if (response.result?.sessionId) {
          console.log('✅ Session created, sending analysis request...');

          const analysisId = 'prompt-' + randomUUID();
          const analysisMessage = {
            jsonrpc: '2.0',
            id: analysisId,
            method: 'session/prompt',
            params: {
              sessionId: response.result.sessionId,
              prompt:
                'Analyze this simple JavaScript function: function add(a, b) { return a + b; }',
            },
          };

          this.responseHandlers.set(analysisId, (analysisResponse) => {
            console.log('✅ Code analysis test completed');
            resolve(analysisResponse);
          });

          await this.sendMessage(analysisMessage);
        } else {
          console.log('❌ Code analysis test failed - no session created');
          resolve(null);
        }
      });

      this.sendMessage(message);

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.responseHandlers.has(testId)) {
          this.responseHandlers.delete(testId);
          console.log('❌ Code analysis test timed out');
          resolve(null);
        }
      }, 30000);
    });
  }

  async runErrorHandlingTest() {
    console.log('\n🧪 Running Error Handling Test...');

    const testId = 'error-' + randomUUID();
    const message = {
      jsonrpc: '2.0',
      id: testId,
      method: 'invalid/method',
      params: { invalidParam: 'test' },
    };

    return new Promise((resolve) => {
      this.responseHandlers.set(testId, (response) => {
        if (response.error) {
          console.log(
            '✅ Error handling test passed - error properly returned',
          );
        } else {
          console.log('❌ Error handling test failed - no error returned');
        }
        resolve(response);
      });

      this.sendMessage(message);

      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.responseHandlers.has(testId)) {
          this.responseHandlers.delete(testId);
          console.log('❌ Error handling test timed out');
          resolve(null);
        }
      }, 5000);
    });
  }

  async cleanup() {
    console.log('🧹 Cleaning up...');
    if (this.containerProcess) {
      this.containerProcess.kill();
    }
  }
}

// Main execution
async function main() {
  const configPath = path.join(
    'test',
    'agent-communication',
    'lumilink-be',
    'agent-config.json',
  );

  try {
    const configData = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configData);

    const agent = new LumiLinkBEMockAgent(config);

    // Set up cleanup on exit
    process.on('SIGINT', async () => {
      await agent.cleanup();
      process.exit(0);
    });

    await agent.initialize();

    // Run test scenarios
    await agent.runBasicConnectionTest();
    await agent.runCodeAnalysisTest();
    await agent.runErrorHandlingTest();

    console.log('\n🎉 All tests completed!');
    console.log(
      '📋 Check logs in: test/agent-communication/logs/lumilink-be.log',
    );

    // Keep running for manual testing
    console.log('\n🔄 Agent running... Press Ctrl+C to exit');
  } catch (error) {
    console.error('❌ Failed to start LumiLink-BE Mock Agent:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { LumiLinkBEMockAgent };
