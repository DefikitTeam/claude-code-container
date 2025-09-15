#!/usr/bin/env node
/**
 * ACP Agent Implementation for Claude Code Container
 *
 * This implements the Agent Client Protocol (ACP) to expose Claude Code
 * functionality to any ACP-compatible editor (Zed, VS Code, etc.)
 */

import { AgentSideConnection } from '@zed-industries/agent-client-protocol';
import { query, type SDKMessage } from '@anthropic-ai/claude-code';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import simpleGit from 'simple-git';
import dotenv from 'dotenv';

dotenv.config();

interface ClaudeCodeSession {
  id: string;
  workspaceDir: string;
  isActive: boolean;
  lastActivity: number;
}

class ClaudeCodeACPAgent {
  private connection: AgentSideConnection;
  private sessions: Map<string, ClaudeCodeSession> = new Map();
  private sessionTimeout = 30 * 60 * 1000; // 30 minutes

  constructor() {
    this.connection = new AgentSideConnection();
    this.setupEventHandlers();
    this.startSessionCleanup();
  }

  private setupEventHandlers() {
    // Handle initialization
    this.connection.onInitialize(async (params) => {
      console.log('[ACP-AGENT] Initialized with client:', params.clientInfo);
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
    });

    // Handle session creation
    this.connection.onCreateSession(async (params) => {
      const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      // Create workspace for this session
      const workspaceDir = path.join(os.tmpdir(), `claude-acp-${sessionId}`);
      await fs.mkdir(workspaceDir, { recursive: true });

      const session: ClaudeCodeSession = {
        id: sessionId,
        workspaceDir,
        isActive: true,
        lastActivity: Date.now()
      };

      this.sessions.set(sessionId, session);

      console.log('[ACP-AGENT] Created session:', sessionId, 'workspace:', workspaceDir);

      return {
        sessionId,
        capabilities: ['code_generation', 'file_operations', 'git_operations', 'project_analysis']
      };
    });

    // Handle task execution
    this.connection.onExecuteTask(async (params) => {
      const session = this.sessions.get(params.sessionId);
      if (!session) {
        throw new Error(`Session ${params.sessionId} not found`);
      }

      session.lastActivity = Date.now();

      console.log('[ACP-AGENT] Executing task:', params.task.type, 'in session:', params.sessionId);

      const originalCwd = process.cwd();
      process.chdir(session.workspaceDir);

      try {
        switch (params.task.type) {
          case 'analyze_code':
            return await this.handleAnalyzeCode(params.task.data, session);

          case 'generate_code':
            return await this.handleGenerateCode(params.task.data, session);

          case 'fix_issue':
            return await this.handleFixIssue(params.task.data, session);

          case 'review_code':
            return await this.handleReviewCode(params.task.data, session);

          default:
            throw new Error(`Unknown task type: ${params.task.type}`);
        }
      } finally {
        process.chdir(originalCwd);
      }
    });

    // Handle file operations
    this.connection.onReadFile(async (params) => {
      const session = this.sessions.get(params.sessionId);
      if (!session) {
        throw new Error(`Session ${params.sessionId} not found`);
      }

      const filePath = path.resolve(session.workspaceDir, params.path);

      // Security check: ensure file is within workspace
      if (!filePath.startsWith(session.workspaceDir)) {
        throw new Error('Access denied: file outside workspace');
      }

      try {
        const content = await fs.readFile(filePath, 'utf8');
        return { content };
      } catch (error) {
        throw new Error(`Failed to read file: ${(error as Error).message}`);
      }
    });

    this.connection.onWriteFile(async (params) => {
      const session = this.sessions.get(params.sessionId);
      if (!session) {
        throw new Error(`Session ${params.sessionId} not found`);
      }

      const filePath = path.resolve(session.workspaceDir, params.path);

      // Security check: ensure file is within workspace
      if (!filePath.startsWith(session.workspaceDir)) {
        throw new Error('Access denied: file outside workspace');
      }

      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, params.content, 'utf8');
        return { success: true };
      } catch (error) {
        throw new Error(`Failed to write file: ${(error as Error).message}`);
      }
    });

    // Handle session cleanup
    this.connection.onDestroySession(async (params) => {
      const session = this.sessions.get(params.sessionId);
      if (session) {
        await this.cleanupSession(session);
        this.sessions.delete(params.sessionId);
        console.log('[ACP-AGENT] Destroyed session:', params.sessionId);
      }
      return { success: true };
    });
  }

  private async handleAnalyzeCode(data: any, session: ClaudeCodeSession): Promise<any> {
    const prompt = this.buildAnalysisPrompt(data);
    const results = await this.executeClaudeCode(prompt, session);

    return {
      type: 'analysis_result',
      analysis: this.extractAnalysisFromResults(results),
      suggestions: this.extractSuggestionsFromResults(results),
      files_analyzed: data.files || []
    };
  }

  private async handleGenerateCode(data: any, session: ClaudeCodeSession): Promise<any> {
    const prompt = this.buildGenerationPrompt(data);
    const results = await this.executeClaudeCode(prompt, session);

    return {
      type: 'code_generation_result',
      generated_files: await this.detectGeneratedFiles(session),
      summary: this.extractSummaryFromResults(results)
    };
  }

  private async handleFixIssue(data: any, session: ClaudeCodeSession): Promise<any> {
    const prompt = this.buildFixPrompt(data);
    const results = await this.executeClaudeCode(prompt, session);

    return {
      type: 'fix_result',
      changes_made: await this.detectFileChanges(session),
      fix_summary: this.extractSummaryFromResults(results),
      tests_needed: this.extractTestingFromResults(results)
    };
  }

  private async handleReviewCode(data: any, session: ClaudeCodeSession): Promise<any> {
    const prompt = this.buildReviewPrompt(data);
    const results = await this.executeClaudeCode(prompt, session);

    return {
      type: 'review_result',
      issues_found: this.extractIssuesFromResults(results),
      recommendations: this.extractRecommendationsFromResults(results),
      quality_score: this.extractQualityScoreFromResults(results)
    };
  }

  private async executeClaudeCode(prompt: string, session: ClaudeCodeSession): Promise<SDKMessage[]> {
    const results: SDKMessage[] = [];

    console.log('[ACP-AGENT] Executing Claude Code in session:', session.id);

    try {
      // Set debug logging for Claude Code
      if (!process.env.DEBUG) {
        process.env.DEBUG = 'claude-code:*';
      }

      for await (const message of query({
        prompt,
        options: { permissionMode: 'bypassPermissions' }
      })) {
        results.push(message as SDKMessage);

        // Send progress updates to client
        this.connection.sendNotification('task_progress', {
          sessionId: session.id,
          progress: results.length,
          message: `Processing turn ${results.length}`
        });
      }

      return results;
    } catch (error) {
      console.error('[ACP-AGENT] Claude Code execution failed:', error);
      throw new Error(`Claude Code execution failed: ${(error as Error).message}`);
    }
  }

  private buildAnalysisPrompt(data: any): string {
    return `
Please analyze the following code/project:

${data.description || 'Analyze the current codebase'}

Focus on:
- Code structure and architecture
- Potential issues or bugs
- Performance considerations
- Best practices compliance
- Security concerns

${data.specific_files ? `Specific files to analyze: ${data.specific_files.join(', ')}` : ''}
${data.analysis_type ? `Analysis type: ${data.analysis_type}` : ''}

Provide a detailed analysis with actionable recommendations.
`;
  }

  private buildGenerationPrompt(data: any): string {
    return `
Please generate code based on the following requirements:

${data.requirements || 'Generate the requested code'}

Specifications:
${data.specifications ? `- ${data.specifications.join('\n- ')}` : ''}

${data.language ? `Programming language: ${data.language}` : ''}
${data.framework ? `Framework: ${data.framework}` : ''}
${data.patterns ? `Follow patterns: ${data.patterns.join(', ')}` : ''}

Please create well-structured, documented code that follows best practices.
`;
  }

  private buildFixPrompt(data: any): string {
    return `
Please fix the following issue:

Issue: ${data.issue_description || 'Fix the reported issue'}

${data.error_message ? `Error message: ${data.error_message}` : ''}
${data.steps_to_reproduce ? `Steps to reproduce:\n${data.steps_to_reproduce}` : ''}
${data.expected_behavior ? `Expected behavior: ${data.expected_behavior}` : ''}
${data.actual_behavior ? `Actual behavior: ${data.actual_behavior}` : ''}

Please identify the root cause and implement a fix with appropriate tests.
`;
  }

  private buildReviewPrompt(data: any): string {
    return `
Please review the following code for quality and best practices:

${data.description || 'Review the current code'}

Review criteria:
- Code quality and maintainability
- Performance and efficiency
- Security considerations
- Testing coverage
- Documentation quality
- Adherence to coding standards

${data.focus_areas ? `Focus on: ${data.focus_areas.join(', ')}` : ''}

Provide specific recommendations for improvement.
`;
  }

  private extractAnalysisFromResults(results: SDKMessage[]): string {
    return results
      .map(msg => this.getMessageText(msg))
      .join('\n')
      .slice(0, 2000); // Limit response size
  }

  private extractSuggestionsFromResults(results: SDKMessage[]): string[] {
    const text = results.map(msg => this.getMessageText(msg)).join('\n');
    // Simple extraction logic - in practice, you'd use more sophisticated parsing
    const suggestions = text.match(/(?:suggestion|recommend|should|consider)([^.]+\.)/gi) || [];
    return suggestions.slice(0, 10); // Limit to 10 suggestions
  }

  private extractSummaryFromResults(results: SDKMessage[]): string {
    const text = results.map(msg => this.getMessageText(msg)).join('\n');
    return text.slice(0, 500) + (text.length > 500 ? '...' : '');
  }

  private extractTestingFromResults(results: SDKMessage[]): string[] {
    const text = results.map(msg => this.getMessageText(msg)).join('\n');
    const tests = text.match(/(?:test|testing|spec)([^.]+\.)/gi) || [];
    return tests.slice(0, 5);
  }

  private extractIssuesFromResults(results: SDKMessage[]): string[] {
    const text = results.map(msg => this.getMessageText(msg)).join('\n');
    const issues = text.match(/(?:issue|problem|bug|error)([^.]+\.)/gi) || [];
    return issues.slice(0, 10);
  }

  private extractRecommendationsFromResults(results: SDKMessage[]): string[] {
    const text = results.map(msg => this.getMessageText(msg)).join('\n');
    const recommendations = text.match(/(?:recommend|suggest|improve)([^.]+\.)/gi) || [];
    return recommendations.slice(0, 10);
  }

  private extractQualityScoreFromResults(results: SDKMessage[]): number {
    // Simple quality scoring - in practice, you'd implement more sophisticated logic
    const text = results.map(msg => this.getMessageText(msg)).join('\n').toLowerCase();
    let score = 80; // Base score

    if (text.includes('excellent') || text.includes('good')) score += 10;
    if (text.includes('issues') || text.includes('problems')) score -= 15;
    if (text.includes('security') && text.includes('concern')) score -= 20;
    if (text.includes('test') && text.includes('coverage')) score += 5;

    return Math.max(0, Math.min(100, score));
  }

  private async detectGeneratedFiles(session: ClaudeCodeSession): Promise<string[]> {
    try {
      const git = simpleGit(session.workspaceDir);
      const status = await git.status();
      return [...status.created, ...status.modified];
    } catch {
      return [];
    }
  }

  private async detectFileChanges(session: ClaudeCodeSession): Promise<string[]> {
    try {
      const git = simpleGit(session.workspaceDir);
      const status = await git.status();
      return [...status.modified, ...status.created, ...status.deleted];
    } catch {
      return [];
    }
  }

  private getMessageText(message: SDKMessage): string {
    // @ts-ignore
    if (typeof message.text === 'string') return message.text;
    // @ts-ignore
    if (typeof message.content === 'string') return message.content;
    // @ts-ignore
    if (Array.isArray(message.content)) {
      // @ts-ignore
      return message.content.map((c: any) => (c.text || JSON.stringify(c))).join('\n');
    }
    return JSON.stringify(message);
  }

  private async cleanupSession(session: ClaudeCodeSession) {
    try {
      await fs.rm(session.workspaceDir, { recursive: true, force: true });
      console.log('[ACP-AGENT] Cleaned up session workspace:', session.workspaceDir);
    } catch (error) {
      console.error('[ACP-AGENT] Failed to cleanup session:', error);
    }
  }

  private startSessionCleanup() {
    setInterval(() => {
      const now = Date.now();
      for (const [sessionId, session] of this.sessions.entries()) {
        if (now - session.lastActivity > this.sessionTimeout) {
          console.log('[ACP-AGENT] Cleaning up inactive session:', sessionId);
          this.cleanupSession(session);
          this.sessions.delete(sessionId);
        }
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  public start() {
    console.log('[ACP-AGENT] Claude Code ACP Agent starting...');
    console.log('[ACP-AGENT] API Key present:', !!process.env.ANTHROPIC_API_KEY);

    this.connection.listen();
    console.log('[ACP-AGENT] Agent is ready for connections');
  }
}

// Start the agent if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const agent = new ClaudeCodeACPAgent();
  agent.start();
}

export default ClaudeCodeACPAgent;