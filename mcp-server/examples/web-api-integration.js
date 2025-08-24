const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio');
const path = require('path');

const app = express();
app.use(express.json());

/**
 * Express.js Web API Integration Example
 * 
 * This example shows how to create a web API that integrates with
 * the Claude Code Container MCP Server to provide GitHub automation
 * capabilities via HTTP endpoints.
 */

class MCPWebProxy {
  constructor() {
    this.client = null;
    this.transport = null;
  }

  async initializeMCP() {
    this.transport = new StdioClientTransport({
      command: 'node',
      args: [path.resolve(__dirname, '../dist/index.js')],
      env: {
        CLAUDE_CODE_API_URL: process.env.CLAUDE_CODE_API_URL || 'http://localhost:8787'
      }
    });

    this.client = new Client({
      name: 'web-api-proxy',
      version: '1.0.0'
    });

    await this.client.connect(this.transport);
  }

  async closeMCP() {
    if (this.client) {
      await this.client.close();
    }
  }
}

const mcpProxy = new MCPWebProxy();

// Initialize MCP connection on startup
mcpProxy.initializeMCP().catch(console.error);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const result = await mcpProxy.client.callTool({
      name: 'health-check',
      arguments: {}
    });

    res.json({
      success: true,
      health: result.content[0].text
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Process GitHub issue
app.post('/api/process-issue', async (req, res) => {
  try {
    const { repository, issueNumber, branch, title } = req.body;

    if (!repository || !issueNumber) {
      return res.status(400).json({
        success: false,
        error: 'repository and issueNumber are required'
      });
    }

    const result = await mcpProxy.client.callTool({
      name: 'process-github-issue',
      arguments: { repository, issueNumber, branch, title }
    });

    res.json({
      success: true,
      result: result.content[0].text
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Process custom prompt
app.post('/api/process-prompt', async (req, res) => {
  try {
    const { prompt, repository, branch, title } = req.body;

    if (!prompt || !repository) {
      return res.status(400).json({
        success: false,
        error: 'prompt and repository are required'
      });
    }

    const result = await mcpProxy.client.callTool({
      name: 'process-custom-prompt',
      arguments: { prompt, repository, branch, title }
    });

    res.json({
      success: true,
      result: result.content[0].text
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Analyze repository
app.get('/api/analyze/:owner/:repo', async (req, res) => {
  try {
    const repository = `${req.params.owner}/${req.params.repo}`;
    const type = req.query.type || 'basic';

    const result = await mcpProxy.client.callTool({
      name: 'analyze-repository',
      arguments: { repository, type }
    });

    res.json({
      success: true,
      analysis: result.content[0].text
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get system status
app.get('/api/status', async (req, res) => {
  try {
    const result = await mcpProxy.client.readResource({
      uri: 'status://server'
    });

    res.json({
      success: true,
      status: JSON.parse(result.contents[0].text)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get system information
app.get('/api/info', async (req, res) => {
  try {
    const result = await mcpProxy.client.readResource({
      uri: 'system://info'
    });

    res.json({
      success: true,
      info: result.contents[0].text
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get issue analysis prompt
app.get('/api/prompts/issue-analysis', async (req, res) => {
  try {
    const { repository, issueNumber, includeContext } = req.query;

    if (!repository || !issueNumber) {
      return res.status(400).json({
        success: false,
        error: 'repository and issueNumber query parameters are required'
      });
    }

    const result = await mcpProxy.client.getPrompt({
      name: 'analyze-and-resolve-issue',
      arguments: {
        repository,
        issueNumber: parseInt(issueNumber),
        includeContext: includeContext === 'true'
      }
    });

    res.json({
      success: true,
      prompt: result.messages
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// List available tools
app.get('/api/tools', async (req, res) => {
  try {
    const result = await mcpProxy.client.listTools();

    res.json({
      success: true,
      tools: result.tools
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Express error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await mcpProxy.closeMCP();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await mcpProxy.closeMCP();
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Web API server running on port ${PORT}`);
  console.log('Available endpoints:');
  console.log('  GET  /health');
  console.log('  GET  /api/status');
  console.log('  GET  /api/info');
  console.log('  GET  /api/tools');
  console.log('  POST /api/process-issue');
  console.log('  POST /api/process-prompt');
  console.log('  GET  /api/analyze/:owner/:repo');
  console.log('  GET  /api/prompts/issue-analysis');
});

module.exports = app;
