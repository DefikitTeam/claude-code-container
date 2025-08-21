console.log('=== MAIN MODULE STARTUP ===');

import http from 'node:http';
import { URL } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ClaudeCodeProcessor } from './claude-code-processor.js';
import { GitHubService } from './github-service.js';

console.log('Main module imports completed successfully');

/**
 * Claude Code Container - HTTP server for processing GitHub issues
 */
class ClaudeCodeContainer {
  constructor() {
    this.port = parseInt(process.env.PORT || '8080');
    this.containerId = process.env.CONTAINER_ID || 'unknown';
    this.processor = new ClaudeCodeProcessor();
    this.githubService = new GitHubService();
    this.server = null;
  }

  /**
   * Create and configure HTTP server
   */
  createServer() {
    this.server = http.createServer(async (req, res) => {
      try {
        await this.handleRequest(req, res);
      } catch (error) {
        console.error('Request handling error:', error);
        this.sendErrorResponse(res, 500, 'Internal server error', error.message);
      }
    });

    // Graceful shutdown handling
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));

    return this.server;
  }

  /**
   * Handle incoming HTTP requests
   */
  async handleRequest(req, res) {
    const url = new URL(req.url, `http://localhost:${this.port}`);
    const method = req.method;
    
    console.log(`${method} ${url.pathname} - Container ${this.containerId}`);

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Route requests
    switch (`${method} ${url.pathname}`) {
      case 'GET /':
        return this.handleRoot(res);
      case 'GET /health':
        return this.handleHealth(res);
      case 'POST /process-issue':
        return this.handleProcessIssue(req, res);
      case 'POST /analyze-repository':
        return this.handleAnalyzeRepository(req, res);
      case 'GET /status':
        return this.handleStatus(res);
      default:
        this.sendErrorResponse(res, 404, 'Not Found', `Path ${url.pathname} not found`);
    }
  }

  /**
   * Handle root endpoint
   */
  handleRoot(res) {
    const response = {
      message: 'Claude Code Container',
      containerId: this.containerId,
      endpoints: {
        '/': 'Container information',
        '/health': 'Health check',
        '/process-issue': 'POST - Process GitHub issue',
        '/analyze-repository': 'POST - Analyze repository content for issues',
        '/status': 'Container status'
      },
      timestamp: new Date().toISOString()
    };

    this.sendJsonResponse(res, 200, response);
  }

  /**
   * Handle health check
   */
  handleHealth(res) {
    const health = {
      status: 'healthy',
      containerId: this.containerId,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };

    this.sendJsonResponse(res, 200, health);
  }

  /**
   * Handle GitHub issue processing with comprehensive error handling
   */
  async handleProcessIssue(req, res) {
    const startTime = Date.now();
    const operationId = `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`=== HANDLE PROCESS ISSUE START [${operationId}] ===`);
    
    try {
      // Validate request and parse body with proper error handling
      const { requestData, validationErrors } = await this.validateAndParseRequest(req);
      
      if (validationErrors.length > 0) {
        return this.sendErrorResponse(res, 400, 'Validation Failed', {
          errors: validationErrors,
          operationId,
          timestamp: new Date().toISOString()
        });
      }

      console.log(`[${operationId}] Request validation successful`);
      console.log(`[${operationId}] Issue: #${requestData.payload?.issue?.number}`);
      console.log(`[${operationId}] Repository: ${requestData.payload?.repository?.full_name}`);

      // Process with comprehensive error tracking
      const result = await this.processGitHubIssueWithErrorHandling(
        requestData.payload, 
        requestData.config, 
        operationId
      );
      
      // Add operation metadata to result
      result.metadata = {
        operationId,
        processingTime: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      };
      
      console.log(`[${operationId}] Processing completed in ${Date.now() - startTime}ms`);
      this.sendJsonResponse(res, 200, result);

    } catch (error) {
      console.error(`=== HANDLE PROCESS ISSUE ERROR [${operationId}] ===`);
      console.error('Error details:', this.formatErrorDetails(error));
      
      this.sendErrorResponse(res, 500, 'Processing Failed', {
        error: error.message,
        errorType: error.constructor.name,
        operationId,
        processingTime: Date.now() - startTime,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle repository analysis for proactive issue detection
   */
  async handleAnalyzeRepository(req, res) {
    console.log('=== HANDLE ANALYZE REPOSITORY START ===');
    
    try {
      const body = await this.getRequestBody(req);
      const requestData = JSON.parse(body);
      
      console.log('Repository analysis request:', {
        repository: requestData.repository?.full_name,
        options: requestData.options || {}
      });
      
      // Setup workspace for analysis
      const cloneUrl = requestData.repository?.clone_url || 
                      `https://github.com/${requestData.repository?.full_name}.git`;
      const workspaceDir = await this.setupWorkspace(cloneUrl, requestData.config || {}, console.log);
      
      // Perform comprehensive repository analysis
      const analysisOptions = {
        maxFiles: 15,
        autoFix: requestData.options?.autoFix || false,
        fileTypes: requestData.options?.fileTypes || ['.md', '.txt', '.js', '.ts', '.json'],
        ...requestData.options
      };
      
      console.log('Starting repository content analysis with options:', analysisOptions);
      const analysis = await this.processor.analyzeRepositoryContent(workspaceDir, analysisOptions);
      
      // Generate proactive recommendations
      const recommendations = this.generateProactiveRecommendations(analysis);
      
      // Cleanup workspace
      await this.cleanupWorkspace(workspaceDir);
      
      const result = {
        success: true,
        message: 'Repository analysis completed',
        analysis: {
          ...analysis,
          recommendations
        },
        timestamp: new Date().toISOString()
      };
      
      console.log('Repository analysis completed:', {
        totalFiles: analysis.totalFiles,
        filesWithIssues: analysis.filesWithIssues,
        totalIssues: analysis.summary?.stats?.total || 0,
        autoFixesApplied: analysis.fixResults?.totalFixes || 0
      });
      
      this.sendJsonResponse(res, 200, result);
      console.log('=== HANDLE ANALYZE REPOSITORY END - SUCCESS ===');
      
    } catch (error) {
      console.error('=== HANDLE ANALYZE REPOSITORY ERROR ===');
      console.error('Repository analysis error:', error);
      
      this.sendErrorResponse(res, 500, 'Analysis Failed', error.message);
      console.log('=== HANDLE ANALYZE REPOSITORY END - ERROR ===');
    }
  }

  /**
   * Generate proactive recommendations based on analysis
   */
  generateProactiveRecommendations(analysis) {
    const recommendations = [...(analysis.summary?.recommendations || [])];
    
    // Add proactive suggestions based on findings
    if (analysis.summary?.stats?.total > 10) {
      recommendations.push({
        priority: 'medium',
        action: 'schedule_cleanup',
        description: `Found ${analysis.summary.stats.total} issues - consider scheduled maintenance`
      });
    }
    
    if (analysis.summary?.stats?.byType?.typo > 5) {
      recommendations.push({
        priority: 'low',
        action: 'setup_spellcheck',
        description: 'Consider setting up automated spell checking in CI/CD'
      });
    }
    
    if (analysis.filesWithIssues > analysis.totalFiles * 0.5) {
      recommendations.push({
        priority: 'high',
        action: 'code_quality_review',
        description: 'More than 50% of files have issues - comprehensive review recommended'
      });
    }
    
    return recommendations;
  }

  /**
   * Handle status endpoint
   */
  handleStatus(res) {
    const status = {
      containerId: this.containerId,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      env: {
        NODE_ENV: process.env.NODE_ENV,
        hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY
      },
      timestamp: new Date().toISOString()
    };

    this.sendJsonResponse(res, 200, status);
  }

  /**
   * Simplified Claude Code test without git operations
   */
  async testClaudeCodeDirectly(issue) {
    console.log('=== DIRECT CLAUDE CODE TEST ===');
    console.log('Issue:', issue.number, '-', issue.title);
    console.log('ANTHROPIC_API_KEY available:', !!process.env.ANTHROPIC_API_KEY);
    
    try {
      // Initialize processor
      console.log('Initializing Claude Code processor...');
      const analysis = await this.processor.analyzeIssue(issue, '/tmp');
      console.log('Claude Code analysis completed');
      
      return {
        success: true,
        message: 'Direct Claude Code test successful',
        analysis: analysis.analysis,
        issueNumber: issue.number,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Direct Claude Code test failed:', error);
      throw error;
    }
  }

  /**
   * Process GitHub issue with comprehensive error handling and recovery
   */
  async processGitHubIssueWithErrorHandling(payload, config, operationId) {
    const maxRetries = 3;
    const retryDelays = [1000, 3000, 5000]; // Progressive backoff
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[${operationId}] Processing attempt ${attempt}/${maxRetries}`);
        return await this.processGitHubIssue(payload, config, operationId);
      } catch (error) {
        console.error(`[${operationId}] Attempt ${attempt} failed:`, error.message);
        
        // Determine if error is retryable
        if (!this.isRetryableError(error) || attempt === maxRetries) {
          // Log final failure details
          console.error(`[${operationId}] Final failure after ${attempt} attempts`);
          console.error(`[${operationId}] Error details:`, this.formatErrorDetails(error));
          
          // Return structured error response instead of throwing
          return {
            success: false,
            message: 'Issue processing failed after retries',
            error: error.message,
            errorType: error.constructor.name,
            attemptsCount: attempt,
            operationId,
            recoveryOptions: this.generateRecoveryOptions(error),
            timestamp: new Date().toISOString()
          };
        }
        
        // Wait before retry
        if (attempt < maxRetries) {
          console.log(`[${operationId}] Waiting ${retryDelays[attempt - 1]}ms before retry`);
          await new Promise(resolve => setTimeout(resolve, retryDelays[attempt - 1]));
        }
      }
    }
  }

  /**
   * Process GitHub issue using Claude Code (original method with enhanced error tracking)
   */
  async processGitHubIssue(payload, config, operationId = 'unknown') {
    const logs = [];
    const log = (message) => {
      console.log(message);
      logs.push(`${new Date().toISOString()}: ${message}`);
    };

    try {
      // Debug payload structure
      console.log('=== CONTAINER PROCESSING DEBUG ===');
      console.log('Payload keys:', Object.keys(payload));
      console.log('Repository keys:', Object.keys(payload.repository || {}));
      console.log('Clone URL:', payload.repository?.clone_url);
      console.log('Repository full_name:', payload.repository?.full_name);
      console.log('Issue number:', payload.issue?.number);
      console.log('===================================');
      
      // Get clone URL with fallback
      let cloneUrl = payload.repository?.clone_url;
      console.log(`Original clone_url: ${cloneUrl}`);
      console.log(`Repository full_name: ${payload.repository?.full_name}`);
      
      if (!cloneUrl) {
        if (payload.repository?.full_name) {
          // Fallback: construct clone URL from repository full_name
          cloneUrl = `https://github.com/${payload.repository.full_name}.git`;
          log(`Constructed clone URL from full_name: ${cloneUrl}`);
          console.log(`Constructed clone URL: ${cloneUrl}`);
        } else {
          throw new Error('Unable to determine repository clone URL - no clone_url or full_name available');
        }
      }
      
      // Setup workspace
      const workspaceDir = await this.setupWorkspace(cloneUrl, config, log);
      
      // Initialize GitHub service
      console.log('=== GITHUB SERVICE INITIALIZATION DEBUG ===');
      console.log('Config keys:', Object.keys(config || {}));
      console.log('installationToken available:', !!config?.installationToken);
      console.log('installationToken length:', config?.installationToken?.length || 0);
      console.log('Repository:', payload.repository?.full_name);
      console.log('=============================================');
      
      this.githubService.initialize(config, payload.repository);
      
      // Process issue with Claude Code using enhanced semantic analysis
      log(`Analyzing issue with enhanced semantics: ${payload.issue.title}`);
      const analysis = await this.processor.analyzeIssueWithSemantics(payload.issue, workspaceDir);
      
      // Generate solution with enhanced context
      log('Generating solution with enhanced Claude Code processing');
      const solution = await this.processor.generateSolution(analysis, workspaceDir, analysis.repositoryContext);
      
      if (solution.hasChanges) {
        // Create feature branch and commit changes
        log('Creating feature branch and committing changes');
        const branchName = `claude-fix-issue-${payload.issue.number}`;
        await this.processor.commitChanges(workspaceDir, branchName, solution.summary);
        
        // Push changes and create PR
        log('Pushing changes and creating pull request');
        const pullRequest = await this.githubService.createPullRequest({
          branch: branchName,
          title: `Fix: ${payload.issue.title}`,
          body: this.generatePRBody(payload.issue, solution),
          issueNumber: payload.issue.number
        });

        log(`Pull request created: ${pullRequest.html_url}`);
        
        // Cleanup workspace
        await this.cleanupWorkspace(workspaceDir);

        return {
          success: true,
          message: 'Issue processed successfully with pull request',
          pullRequestUrl: pullRequest.html_url,
          logs
        };
      } else {
        // Post analysis as comment
        log('No changes needed, posting analysis as comment');
        await this.githubService.createIssueComment(payload.issue.number, solution.summary);
        
        // Cleanup workspace
        await this.cleanupWorkspace(workspaceDir);

        return {
          success: true,
          message: 'Issue analyzed and commented on',
          logs
        };
      }

    } catch (error) {
      log(`Processing failed: ${error.message}`);
      
      // Fallback: post error as comment
      try {
        await this.githubService.createIssueComment(
          payload.issue.number,
          `I encountered an error while processing this issue: ${error.message}\\n\\nPlease check the issue details and try again.`
        );
      } catch (commentError) {
        log(`Failed to post error comment: ${commentError.message}`);
      }

      return {
        success: false,
        message: 'Issue processing failed',
        error: error.message,
        logs
      };
    }
  }

  /**
   * Setup temporary workspace for git operations
   */
  async setupWorkspace(cloneUrl, config, log) {
    const workspaceDir = path.join(os.tmpdir(), `claude-workspace-${Date.now()}`);
    
    log(`Setting up workspace: ${workspaceDir}`);
    
    // Validate clone URL
    if (!cloneUrl || typeof cloneUrl !== 'string') {
      throw new Error(`Invalid clone URL: ${cloneUrl}`);
    }
    
    await fs.mkdir(workspaceDir, { recursive: true });
    
    log(`Cloning repository: ${cloneUrl}`);
    console.log(`Installation token available: ${!!config.installationToken}`);
    if (config.installationToken) {
      console.log(`Installation token length: ${config.installationToken.length}`);
      console.log(`Installation token preview: ${config.installationToken.substring(0, 20)}...`);
    }
    
    // Pass installation token for authentication
    await this.processor.cloneRepository(cloneUrl, workspaceDir, config.installationToken);
    
    return workspaceDir;
  }

  /**
   * Cleanup temporary workspace
   */
  async cleanupWorkspace(workspaceDir) {
    try {
      await fs.rm(workspaceDir, { recursive: true, force: true });
      console.log(`Cleaned up workspace: ${workspaceDir}`);
    } catch (error) {
      console.error(`Failed to cleanup workspace ${workspaceDir}:`, error);
    }
  }

  /**
   * Generate pull request body
   */
  generatePRBody(issue, solution) {
    return `## Summary
Automated fix for issue #${issue.number}: ${issue.title}

## Changes Made
${solution.summary}

## Issue Analysis
${solution.analysis || 'Automated analysis performed by Claude Code'}

## Testing
Please review the changes and test thoroughly before merging.

---
🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>`;
  }

  /**
   * Validate and parse incoming request with comprehensive error handling
   */
  async validateAndParseRequest(req) {
    const validationErrors = [];
    let requestData = null;
    
    try {
      // Get request body with timeout
      const body = await this.getRequestBodyWithTimeout(req, 30000); // 30 second timeout
      
      if (!body || body.length === 0) {
        validationErrors.push('Request body is empty');
        return { requestData: null, validationErrors };
      }
      
      if (body.length > 1024 * 1024) { // 1MB limit
        validationErrors.push('Request body too large (max 1MB)');
        return { requestData: null, validationErrors };
      }
      
      // Parse JSON with error handling
      try {
        requestData = JSON.parse(body);
      } catch (parseError) {
        validationErrors.push(`JSON parsing failed: ${parseError.message}`);
        return { requestData: null, validationErrors };
      }
      
      // Validate required fields
      if (!requestData.type) {
        validationErrors.push('Missing required field: type');
      }
      
      if (!requestData.payload) {
        validationErrors.push('Missing required field: payload');
      } else {
        if (!requestData.payload.issue) {
          validationErrors.push('Missing required field: payload.issue');
        } else {
          if (!requestData.payload.issue.number) {
            validationErrors.push('Missing required field: payload.issue.number');
          }
          if (!requestData.payload.issue.title) {
            validationErrors.push('Missing required field: payload.issue.title');
          }
        }
        
        if (!requestData.payload.repository) {
          validationErrors.push('Missing required field: payload.repository');
        } else {
          if (!requestData.payload.repository.full_name) {
            validationErrors.push('Missing required field: payload.repository.full_name');
          }
        }
      }
      
      if (!requestData.config) {
        validationErrors.push('Missing required field: config');
      } else {
        if (!requestData.config.installationToken) {
          validationErrors.push('Missing required field: config.installationToken');
        }
      }
      
      return { requestData, validationErrors };
      
    } catch (error) {
      validationErrors.push(`Request validation failed: ${error.message}`);
      return { requestData: null, validationErrors };
    }
  }

  /**
   * Get request body with timeout protection
   */
  async getRequestBodyWithTimeout(req, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      let body = '';
      let timeout;
      
      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        req.removeAllListeners('data');
        req.removeAllListeners('end');
        req.removeAllListeners('error');
      };
      
      timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      
      req.on('data', chunk => {
        body += chunk.toString();
        // Prevent memory exhaustion
        if (body.length > 1024 * 1024) { // 1MB limit
          cleanup();
          reject(new Error('Request body too large'));
        }
      });
      
      req.on('end', () => {
        cleanup();
        resolve(body);
      });
      
      req.on('error', (error) => {
        cleanup();
        reject(error);
      });
    });
  }

  /**
   * Send JSON response
   */
  sendJsonResponse(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }

  /**
   * Send error response
   */
  sendErrorResponse(res, statusCode, error, message) {
    const errorResponse = {
      error,
      message,
      timestamp: new Date().toISOString(),
      containerId: this.containerId
    };
    
    this.sendJsonResponse(res, statusCode, errorResponse);
  }

  /**
   * Start the server
   */
  async start() {
    this.createServer();
    
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`Claude Code Container started on port ${this.port}`);
        console.log(`Container ID: ${this.containerId}`);
        console.log(`Node.js version: ${process.version}`);
        resolve();
      });
    });
  }

  /**
   * Graceful shutdown
   */
  async gracefulShutdown(signal) {
    console.log(`Received ${signal}, shutting down gracefully...`);
    
    if (this.server) {
      this.server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
      });
      
      // Force exit after 5 seconds
      setTimeout(() => {
        console.log('Force shutdown after timeout');
        process.exit(1);
      }, 5000);
    } else {
      process.exit(0);
    }
  }

  /**
   * Check if an error is retryable
   */
  isRetryableError(error) {
    const retryableErrors = [
      'ECONNRESET',
      'ECONNREFUSED', 
      'ETIMEDOUT',
      'ENOTFOUND',
      'EAI_AGAIN',
      'timeout',
      'network',
      'temporary'
    ];
    
    const errorString = error.message.toLowerCase();
    return retryableErrors.some(pattern => 
      errorString.includes(pattern) || error.code === pattern
    );
  }

  /**
   * Format error details for logging
   */
  formatErrorDetails(error) {
    return {
      message: error.message,
      type: error.constructor.name,
      code: error.code,
      stack: error.stack?.substring(0, 1000),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate recovery options based on error type
   */
  generateRecoveryOptions(error) {
    const options = [];
    
    if (error.message.includes('ANTHROPIC_API_KEY')) {
      options.push({
        action: 'verify_api_key',
        description: 'Verify ANTHROPIC_API_KEY environment variable is set correctly'
      });
    }
    
    if (error.message.includes('clone') || error.message.includes('git')) {
      options.push({
        action: 'check_repository_access',
        description: 'Verify repository access permissions and clone URL'
      });
    }
    
    if (error.message.includes('token') || error.message.includes('auth')) {
      options.push({
        action: 'refresh_github_token',
        description: 'Refresh GitHub installation access token'
      });
    }
    
    if (error.message.includes('timeout')) {
      options.push({
        action: 'retry_with_longer_timeout',
        description: 'Retry the operation with increased timeout values'
      });
    }
    
    // Default recovery option
    if (options.length === 0) {
      options.push({
        action: 'manual_review',
        description: 'Manual review of the issue and repository state required'
      });
    }
    
    return options;
  }
}

// Start the container
async function startContainer() {
  try {
    console.log('=== CONTAINER STARTUP BEGIN ===');
    console.log('Node.js version:', process.version);
    console.log('Platform:', process.platform);
    console.log('Environment variables:');
    console.log('- ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? 'SET' : 'NOT SET');
    console.log('- PORT:', process.env.PORT || 'NOT SET');
    console.log('- NODE_ENV:', process.env.NODE_ENV || 'NOT SET');
    console.log('- CONTAINER_ID:', process.env.CONTAINER_ID || 'NOT SET');
    
    // Log Deep Inference configuration
    logDeepInferenceConfig();
    
    console.log('Initializing Claude Code Container...');
    const container = new ClaudeCodeContainer();
    console.log('Container instance created, starting server...');
    await container.start();
    console.log('Container startup completed successfully');
    console.log('=== CONTAINER STARTUP END ===');
  } catch (error) {
    console.error('=== CONTAINER STARTUP FAILED ===');
    console.error('Failed to start container:', error);
    console.error('Error type:', typeof error);
    console.error('Error constructor:', error.constructor.name);
    console.error('Error message:', error.message);
    if (error.stack) {
      console.error('Error stack:', error.stack);
    }
    console.error('=== EXITING WITH CODE 1 ===');
    process.exit(1);
  }
}

// Handle uncaught exceptions and rejections gracefully
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  console.error('Stack:', error.stack);
  
  // Don't exit immediately for Claude Code SDK errors
  if (error.message?.includes('Symbol.asyncIterator') || error.message?.includes('streamToStdin')) {
    console.warn('Claude Code SDK error detected - continuing with fallback processing');
    return;
  }
  
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  
  // Don't exit for Claude Code SDK errors
  if (reason?.message?.includes('Symbol.asyncIterator') || reason?.message?.includes('streamToStdin')) {
    console.warn('Claude Code SDK rejection detected - continuing with fallback processing');
    return;
  }
  
  process.exit(1);
});

// ===== CLAUDE DEEP INFERENCE CONFIGURATION =====
function logDeepInferenceConfig() {
  const deepReasoningEnabled = process.env.ENABLE_DEEP_REASONING === 'true';
  const complexityThreshold = parseFloat(process.env.DEEP_REASONING_THRESHOLD || '0.3');
  const forceProfile = process.env.FORCE_DEEP_PROFILE || 'auto';
  const processingTimeout = parseInt(process.env.PROCESSING_TIMEOUT || '45000');
  
  console.log('🧠 ===== CLAUDE DEEP INFERENCE CONFIGURATION =====');
  console.log(`🎯 Deep Reasoning Enabled: ${deepReasoningEnabled ? '✅ YES' : '❌ NO'}`);
  console.log(`📊 Complexity Threshold: ${complexityThreshold} (0.0-1.0)`);
  console.log(`⚙️  Force Profile: ${forceProfile}`);
  console.log(`⏱️  Processing Timeout: ${processingTimeout}ms (${Math.round(processingTimeout/1000)}s)`);
  
  if (deepReasoningEnabled) {
    console.log('🔥 QUALITY MODE: Issues will be processed with deep reasoning (30-120s)');
    console.log('📈 Expected improvements: Higher accuracy, better solutions, thorough analysis');
  } else {
    console.log('⚡ SPEED MODE: Issues will be processed quickly (5-10s)');
    console.log('⚠️  Note: Quality may be lower due to limited reasoning time');
  }
  console.log('🧠 =============================================');
}

startContainer();