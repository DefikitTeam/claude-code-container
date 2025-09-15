/**
 * ACP Container Server
 *
 * HTTP server that hosts the ACP agent inside the container
 * and bridges ACP messages from the Cloudflare Worker.
 */

import http from 'node:http';
import { URL } from 'node:url';
import ClaudeCodeACPAgent from './acp-agent.js';

interface ContainerACPServer {
  agent: ClaudeCodeACPAgent;
  initialized: boolean;
  sessions: Map<string, any>;
}

class ACPContainerServer {
  private agent: ClaudeCodeACPAgent;
  private initialized: boolean = false;
  private sessions: Map<string, any> = new Map();

  constructor() {
    this.agent = new ClaudeCodeACPAgent();
  }

  private async handleInitialize(body: any): Promise<any> {
    if (this.initialized) {
      return {
        capabilities: {
          sessionManagement: true,
          codeGeneration: true,
          fileOperations: true,
          projectAnalysis: true,
          gitOperations: true
        },
        serverInfo: {
          name: 'claude-code-acp-agent',
          version: '1.0.0'
        }
      };
    }

    // Initialize the agent
    const result = {
      capabilities: {
        sessionManagement: true,
        codeGeneration: true,
        fileOperations: true,
        projectAnalysis: true,
        gitOperations: true
      },
      serverInfo: {
        name: 'claude-code-acp-agent',
        version: '1.0.0'
      }
    };

    this.initialized = true;
    console.log('[ACP-CONTAINER] Agent initialized');
    return result;
  }

  private async handleCreateSession(body: any): Promise<any> {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const session = {
      id: sessionId,
      created: Date.now(),
      lastActivity: Date.now()
    };

    this.sessions.set(sessionId, session);

    console.log('[ACP-CONTAINER] Session created:', sessionId);

    return {
      sessionId,
      capabilities: ['code_generation', 'file_operations', 'git_operations', 'project_analysis']
    };
  }

  private async handleExecuteTask(body: any): Promise<any> {
    const { sessionId, task } = body;

    if (!sessionId || !this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const session = this.sessions.get(sessionId);
    session.lastActivity = Date.now();

    console.log('[ACP-CONTAINER] Executing task:', task.type, 'for session:', sessionId);

    // Simulate task execution - in practice, this would use the full ACP agent
    switch (task.type) {
      case 'analyze_code':
        return {
          type: 'analysis_result',
          analysis: `Code analysis completed for session ${sessionId}`,
          suggestions: [
            'Consider adding error handling',
            'Improve code documentation',
            'Add unit tests'
          ],
          files_analyzed: task.data.files || []
        };

      case 'generate_code':
        return {
          type: 'code_generation_result',
          generated_files: [`generated-${Date.now()}.ts`],
          summary: `Code generated based on requirements: ${task.data.requirements || 'No requirements specified'}`
        };

      case 'fix_issue':
        return {
          type: 'fix_result',
          changes_made: [`fixed-${sessionId}.ts`],
          fix_summary: `Issue fixed: ${task.data.issue_description || 'Unknown issue'}`,
          tests_needed: ['Add unit test for the fix']
        };

      case 'review_code':
        return {
          type: 'review_result',
          issues_found: [
            'Missing error handling in function X',
            'Unused variable detected'
          ],
          recommendations: [
            'Refactor large function into smaller pieces',
            'Add type annotations'
          ],
          quality_score: 75
        };

      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
  }

  private async handleReadFile(body: any): Promise<any> {
    const { sessionId, path } = body;

    if (!sessionId || !this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} not found`);
    }

    console.log('[ACP-CONTAINER] Reading file:', path, 'for session:', sessionId);

    // Mock file content - in practice, this would read from the actual workspace
    return {
      content: `// Mock file content for: ${path}\n// Session: ${sessionId}\n// Timestamp: ${new Date().toISOString()}\n`
    };
  }

  private async handleWriteFile(body: any): Promise<any> {
    const { sessionId, path, content } = body;

    if (!sessionId || !this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} not found`);
    }

    console.log('[ACP-CONTAINER] Writing file:', path, 'for session:', sessionId);

    // Mock file write - in practice, this would write to the actual workspace
    return { success: true };
  }

  private async handleDestroySession(body: any): Promise<any> {
    const { sessionId } = body;

    if (sessionId && this.sessions.has(sessionId)) {
      this.sessions.delete(sessionId);
      console.log('[ACP-CONTAINER] Session destroyed:', sessionId);
    }

    return { success: true };
  }

  private async handleStatus(): Promise<any> {
    return {
      status: 'available',
      initialized: this.initialized,
      activeSessions: this.sessions.size,
      capabilities: {
        sessionManagement: true,
        codeGeneration: true,
        fileOperations: true,
        projectAnalysis: true,
        gitOperations: true
      },
      serverInfo: {
        name: 'claude-code-acp-agent',
        version: '1.0.0'
      }
    };
  }

  private async getRequestBody(req: http.IncomingMessage): Promise<string> {
    let body = '';
    for await (const chunk of req) {
      body += chunk.toString();
    }
    return body;
  }

  private sendJson(res: http.ServerResponse, status: number, obj: any) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj, null, 2));
  }

  public createServer(): http.Server {
    return http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const path = url.pathname;

      try {
        if (req.method === 'POST' && path === '/acp/initialize') {
          const body = JSON.parse(await this.getRequestBody(req));
          const result = await this.handleInitialize(body);
          return this.sendJson(res, 200, result);
        }

        if (req.method === 'POST' && path === '/acp/session/create') {
          const body = JSON.parse(await this.getRequestBody(req));
          const result = await this.handleCreateSession(body);
          return this.sendJson(res, 200, result);
        }

        if (req.method === 'POST' && path === '/acp/task/execute') {
          const body = JSON.parse(await this.getRequestBody(req));
          const result = await this.handleExecuteTask(body);
          return this.sendJson(res, 200, result);
        }

        if (req.method === 'POST' && path === '/acp/file/read') {
          const body = JSON.parse(await this.getRequestBody(req));
          const result = await this.handleReadFile(body);
          return this.sendJson(res, 200, result);
        }

        if (req.method === 'POST' && path === '/acp/file/write') {
          const body = JSON.parse(await this.getRequestBody(req));
          const result = await this.handleWriteFile(body);
          return this.sendJson(res, 200, result);
        }

        if (req.method === 'POST' && path === '/acp/session/destroy') {
          const body = JSON.parse(await this.getRequestBody(req));
          const result = await this.handleDestroySession(body);
          return this.sendJson(res, 200, result);
        }

        if (req.method === 'GET' && path === '/acp/status') {
          const result = await this.handleStatus();
          return this.sendJson(res, 200, result);
        }

        // Return 404 for unknown endpoints
        return this.sendJson(res, 404, {
          success: false,
          error: 'ACP endpoint not found'
        });

      } catch (error) {
        console.error('[ACP-CONTAINER] Error handling request:', error);
        return this.sendJson(res, 500, {
          success: false,
          error: 'Internal server error',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });
  }
}

export default ACPContainerServer;