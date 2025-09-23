#!/usr/bin/env node

/**
 * Example Client Agent demonstrating communication with Claude Code Container
 * 
 * This shows how any external agent system can communicate with the container
 * to perform GitHub operations and code analysis.
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

class ACPClient {
  constructor() {
    this.container = null;
    this.messageId = 1;
    this.sessionId = null;
  }

  async connect() {
    console.log('🚀 Connecting to Claude Code Container...');
    
    // Spawn container in generic ACP mode
    this.container = spawn('node', ['dist/main.js', '--generic-acp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });

    this.container.stderr.on('data', (data) => {
      console.log(`[CONTAINER] ${data.toString().trim()}`);
    });

    // Initialize connection
    const initResponse = await this.sendRequest('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true
        }
      }
    });

    console.log('✅ Connection established:', initResponse.result);
    return initResponse;
  }

  async createSession(workspaceUri = process.cwd()) {
    console.log(`📁 Creating session for workspace: ${workspaceUri}`);
    
    const response = await this.sendRequest('session/new', {
      cwd: workspaceUri,
      mcpServers: []
    });

    this.sessionId = response.result.sessionId;
    console.log(`✅ Session created: ${this.sessionId}`);
    return response;
  }

  async sendPrompt(prompt) {
    if (!this.sessionId) {
      throw new Error('No active session. Call createSession() first.');
    }

    console.log('💭 Sending prompt to Claude...');
    console.log(`Prompt: ${prompt}`);

    const response = await this.sendRequest('session/prompt', {
      sessionId: this.sessionId,
      prompt: [
        {
          type: 'text',
          text: prompt
        }
      ]
    });

    return response;
  }

  async sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.messageId++;
      const message = JSON.stringify({
        jsonrpc: '2.0',
        method,
        id,
        params
      }) + '\n';

      // Set up response handler
      const responseHandler = (data) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            
            if (response.id === id) {
              this.container.stdout.off('data', responseHandler);
              
              if (response.error) {
                reject(new Error(`ACP Error: ${response.error.message}`));
              } else {
                resolve(response);
              }
              return;
            }
            
            // Handle notifications (updates during processing)
            if (response.method === 'session/update') {
              this.handleUpdate(response.params);
            }
          } catch (e) {
            console.warn('Failed to parse response:', line);
          }
        }
      };

      this.container.stdout.on('data', responseHandler);
      
      // Send request
      this.container.stdin.write(message);
      
      // Timeout after 30 seconds
      setTimeout(() => {
        this.container.stdout.off('data', responseHandler);
        reject(new Error('Request timeout'));
      }, 30000);
    });
  }

  handleUpdate(params) {
    const { sessionId, update } = params;
    
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content.type === 'text') {
          process.stdout.write(update.content.text);
        }
        break;
        
      case 'agent_thought_chunk':
        console.log(`[THINKING] ${update.content.text}`);
        break;
        
      case 'tool_call':
        console.log(`[TOOL] ${update.toolName}: ${JSON.stringify(update.rawInput)}`);
        break;
        
      case 'tool_call_update':
        if (update.status === 'completed') {
          console.log(`[TOOL COMPLETE] ${update.toolName}`);
        } else if (update.status === 'failed') {
          console.log(`[TOOL FAILED] ${update.toolName}`);
        }
        break;
        
      default:
        console.log(`[UPDATE] ${update.sessionUpdate}:`, update);
    }
  }

  async close() {
    if (this.container) {
      this.container.kill();
    }
  }
}

// Example usage
async function main() {
  const client = new ACPClient();
  
  try {
    // Connect to container
    await client.connect();
    
    // Create session
    await client.createSession();
    
    // Example prompts
    const prompts = [
      "Hello! Can you tell me about your capabilities?",
      "What GitHub operations can you perform?",
      "Can you help me understand the current working directory structure?"
    ];

    for (const prompt of prompts) {
      console.log('\n' + '='.repeat(60));
      const response = await client.sendPrompt(prompt);
      console.log('\n✅ Prompt completed:', response.result.stopReason);
      console.log('='.repeat(60));
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { ACPClient };