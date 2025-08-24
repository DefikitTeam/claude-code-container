#!/usr/bin/env node

/**
 * Custom MCP Client Example
 * 
 * This example demonstrates how to create a custom client that interacts
 * with the Claude Code Container MCP Server programmatically.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

class ClaudeCodeMCPClient {
  constructor() {
    this.client = new Client({
      name: "custom-client",
      version: "1.0.0"
    });
    this.transport = null;
  }

  async connect() {
    this.transport = new StdioClientTransport({
      command: "node",
      args: ["../dist/index.js"], // Adjust path as needed
      env: {
        CLAUDE_CODE_API_URL: process.env.CLAUDE_CODE_API_URL || "http://localhost:8787"
      }
    });

    await this.client.connect(this.transport);
    console.log("Connected to Claude Code MCP Server");
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      console.log("Disconnected from MCP Server");
    }
  }

  // Process a GitHub issue
  async processIssue(repository, issueNumber, options = {}) {
    try {
      const result = await this.client.callTool({
        name: "process-github-issue",
        arguments: {
          repository,
          issueNumber,
          ...options
        }
      });

      return result.content[0].text;
    } catch (error) {
      throw new Error(`Failed to process issue: ${error.message}`);
    }
  }

  // Analyze repository
  async analyzeRepository(repository, type = "basic") {
    try {
      const result = await this.client.callTool({
        name: "analyze-repository",
        arguments: {
          repository,
          type
        }
      });

      return result.content[0].text;
    } catch (error) {
      throw new Error(`Failed to analyze repository: ${error.message}`);
    }
  }

  // Process custom prompt
  async processCustomPrompt(prompt, repository, options = {}) {
    try {
      const result = await this.client.callTool({
        name: "process-custom-prompt",
        arguments: {
          prompt,
          repository,
          ...options
        }
      });

      return result.content[0].text;
    } catch (error) {
      throw new Error(`Failed to process prompt: ${error.message}`);
    }
  }

  // Check system health
  async checkHealth() {
    try {
      const result = await this.client.callTool({
        name: "health-check",
        arguments: {}
      });

      return result.content[0].text;
    } catch (error) {
      throw new Error(`Health check failed: ${error.message}`);
    }
  }

  // Get system status resource
  async getSystemStatus() {
    try {
      const result = await this.client.readResource({
        uri: "status://server"
      });

      return JSON.parse(result.contents[0].text);
    } catch (error) {
      throw new Error(`Failed to get system status: ${error.message}`);
    }
  }

  // Get system info resource
  async getSystemInfo() {
    try {
      const result = await this.client.readResource({
        uri: "system://info"
      });

      return result.contents[0].text;
    } catch (error) {
      throw new Error(`Failed to get system info: ${error.message}`);
    }
  }

  // Use prompt for issue analysis
  async getIssueAnalysisPrompt(repository, issueNumber, includeContext = false) {
    try {
      const result = await this.client.getPrompt({
        name: "analyze-and-resolve-issue",
        arguments: {
          repository,
          issueNumber,
          includeContext
        }
      });

      return result.messages;
    } catch (error) {
      throw new Error(`Failed to get issue analysis prompt: ${error.message}`);
    }
  }

  // List available tools
  async listTools() {
    try {
      const result = await this.client.listTools();
      return result.tools;
    } catch (error) {
      throw new Error(`Failed to list tools: ${error.message}`);
    }
  }

  // List available resources
  async listResources() {
    try {
      const result = await this.client.listResources();
      return result.resources;
    } catch (error) {
      throw new Error(`Failed to list resources: ${error.message}`);
    }
  }

  // List available prompts
  async listPrompts() {
    try {
      const result = await this.client.listPrompts();
      return result.prompts;
    } catch (error) {
      throw new Error(`Failed to list prompts: ${error.message}`);
    }
  }
}

// Example usage
async function example() {
  const mcpClient = new ClaudeCodeMCPClient();
  
  try {
    await mcpClient.connect();

    // Check system health
    console.log("=== System Health ===");
    const health = await mcpClient.checkHealth();
    console.log(health);

    // List available tools
    console.log("\n=== Available Tools ===");
    const tools = await mcpClient.listTools();
    tools.forEach(tool => {
      console.log(`- ${tool.name}: ${tool.description}`);
    });

    // Get system status
    console.log("\n=== System Status ===");
    const status = await mcpClient.getSystemStatus();
    console.log(JSON.stringify(status, null, 2));

    // Example: Analyze a repository
    if (process.argv.length > 2) {
      const repository = process.argv[2];
      console.log(`\n=== Analyzing Repository: ${repository} ===`);
      const analysis = await mcpClient.analyzeRepository(repository, "detailed");
      console.log(analysis);
    }

    // Example: Process an issue (if issue number provided)
    if (process.argv.length > 3) {
      const repository = process.argv[2];
      const issueNumber = parseInt(process.argv[3]);
      console.log(`\n=== Processing Issue #${issueNumber} in ${repository} ===`);
      const result = await mcpClient.processIssue(repository, issueNumber);
      console.log(result);
    }

  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    await mcpClient.disconnect();
  }
}

// Run example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  example().catch(console.error);
}

export default ClaudeCodeMCPClient;
