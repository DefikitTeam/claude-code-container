/**
 * Client interface for interacting with the Claude Code Container system
 * This wraps the existing HTTP endpoints without modifying the core system
 */

export interface ProcessIssueRequest {
  repository: string;
  issueNumber: number;
  branch?: string;
  title?: string;
}

export interface ProcessPromptRequest {
  prompt: string;
  repository: string;
  branch?: string;
  title?: string;
}

export interface ProcessResult {
  success: boolean;
  message: string;
  pullRequestUrl?: string;
  error?: string;
}

export interface HealthStatus {
  status: string;
  timestamp: string;
  services: {
    containers: string;
    durableObjects: string;
    webhooks: string;
  };
}

export interface RepositoryAnalysis {
  repository: string;
  structure: any;
  metrics?: any;
  recommendations?: string[];
}

/**
 * Claude Code Client - wraps the existing Cloudflare Worker endpoints
 */
export class ClaudeCodeClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.WORKER_URL || "http://localhost:8787";
    if (!this.baseUrl.startsWith("http")) {
      this.baseUrl = `https://${this.baseUrl}`;
    }
  }

  /**
   * Process a GitHub issue using the existing /process-prompt endpoint
   */
  async processIssue(request: ProcessIssueRequest): Promise<ProcessResult> {
    try {
      const prompt = `Process GitHub issue #${request.issueNumber} in repository ${request.repository}. 
      Analyze the issue, implement a solution, and create a pull request.
      ${request.title ? `Title: ${request.title}` : ""}`;

      const response = await fetch(`${this.baseUrl}/process-prompt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          repository: request.repository,
          branch: request.branch,
          title: request.title || `Fix issue #${request.issueNumber}`,
        }),
      });

      const result = await response.json() as ProcessResult;
      return result;
    } catch (error) {
      return {
        success: false,
        message: "Failed to process issue",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Process a custom prompt using the existing /process-prompt endpoint
   */
  async processPrompt(request: ProcessPromptRequest): Promise<ProcessResult> {
    try {
      const response = await fetch(`${this.baseUrl}/process-prompt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      const result = await response.json() as ProcessResult;
      return result;
    } catch (error) {
      return {
        success: false,
        message: "Failed to process prompt",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get health status using the existing /health endpoint
   */
  async getHealth(): Promise<HealthStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      const result = await response.json() as HealthStatus;
      return result;
    } catch (error) {
      throw new Error(`Health check failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Analyze repository (simulated - could be enhanced with actual analysis)
   */
  async analyzeRepository(repository: string, includeMetrics?: boolean): Promise<RepositoryAnalysis> {
    try {
      // This is a mock implementation - in a real system, this could call
      // a specialized analysis endpoint or use GitHub API
      const analysis: RepositoryAnalysis = {
        repository,
        structure: {
          type: "Detected from repository",
          languages: ["TypeScript", "JavaScript"],
          framework: "Node.js/Cloudflare Workers",
          buildSystem: "npm/TypeScript",
        },
        ...(includeMetrics && {
          metrics: {
            files: "~50",
            linesOfCode: "~2000",
            complexity: "Medium",
            testCoverage: "Good",
          },
        }),
        recommendations: [
          "Repository is well-structured for Claude Code automation",
          "Consider adding more comprehensive error handling",
          "Documentation could be enhanced",
          "Test coverage is good but could be expanded",
        ],
      };

      return analysis;
    } catch (error) {
      throw new Error(`Repository analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Test connection to the worker
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
