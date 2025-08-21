import { Octokit } from '@octokit/rest';
import crypto from 'node:crypto';

console.log('GitHubService module loaded successfully');

/**
 * GitHub API service for managing repositories, issues, and pull requests
 */
export class GitHubService {
  constructor() {
    this.octokit = null;
    this.repository = null;
    this.config = null;
  }

  /**
   * Initialize GitHub service with app configuration
   */
  initialize(config, repository) {
    this.config = config;
    this.repository = repository;

    try {
      // Initialize Octokit with installation token
      this.octokit = new Octokit({
        auth: config.installationToken,
        userAgent: 'claude-code-containers/1.0.0'
      });

      console.log('GitHub service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize GitHub service:', error);
      throw new Error(`GitHub service initialization failed: ${error.message}`);
    }
  }

  /**
   * Get installation access token (cached with expiry check)
   */
  async getInstallationToken() {
    try {
      // Check if we have a valid cached token
      if (this.config.installationToken && this.config.tokenExpiresAt) {
        const expiresAt = new Date(this.config.tokenExpiresAt);
        const now = new Date();
        const bufferTime = 5 * 60 * 1000; // 5 minutes buffer

        if (expiresAt.getTime() - now.getTime() > bufferTime) {
          console.log('Using cached installation token');
          return this.config.installationToken;
        }
      }

      // Generate new installation access token
      console.log('Generating new installation access token');
      const response = await this.octokit.rest.apps.createInstallationAccessToken({
        installation_id: this.config.installationId
      });

      // Update config with new token (this should be saved back to Durable Object)
      this.config.installationToken = response.data.token;
      this.config.tokenExpiresAt = new Date(response.data.expires_at).getTime();

      return response.data.token;
    } catch (error) {
      console.error('Failed to get installation token:', error);
      throw new Error(`Installation token generation failed: ${error.message}`);
    }
  }

  /**
   * Create a new pull request
   */
  async createPullRequest({ branch, title, body, issueNumber }) {
    try {
      const [owner, repo] = this.repository.full_name.split('/');
      
      console.log(`Creating PR: ${owner}/${repo} ${branch} -> ${this.repository.default_branch}`);
      
      // First, push the branch to remote
      await this.pushBranch(branch);

      // Create pull request
      const response = await this.octokit.rest.pulls.create({
        owner,
        repo,
        title,
        head: branch,
        base: this.repository.default_branch,
        body,
        maintainer_can_modify: true
      });

      // Link the PR to the issue if provided
      if (issueNumber) {
        await this.linkPullRequestToIssue(response.data.number, issueNumber);
      }

      console.log(`Pull request created: #${response.data.number}`);
      
      return {
        number: response.data.number,
        html_url: response.data.html_url,
        url: response.data.url
      };
    } catch (error) {
      console.error('Failed to create pull request:', error);
      throw new Error(`Pull request creation failed: ${error.message}`);
    }
  }

  /**
   * Push branch to remote repository
   */
  async pushBranch(branch) {
    try {
      // This would typically be handled by the git operations in the processor
      // For now, we'll assume the git push is handled separately
      console.log(`Branch ${branch} should be pushed to remote`);
      
      // In a real implementation, you might need to configure git credentials
      // and push the branch here, or handle it in the ClaudeCodeProcessor
    } catch (error) {
      console.error('Failed to push branch:', error);
      throw new Error(`Branch push failed: ${error.message}`);
    }
  }

  /**
   * Link pull request to issue
   */
  async linkPullRequestToIssue(prNumber, issueNumber) {
    try {
      const [owner, repo] = this.repository.full_name.split('/');
      
      // Add a comment to link the PR to the issue
      await this.octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: `🔗 Pull request #${prNumber} has been created to address this issue.`
      });

      console.log(`Linked PR #${prNumber} to issue #${issueNumber}`);
    } catch (error) {
      console.error('Failed to link PR to issue:', error);
      // This is not critical, so we don't throw
    }
  }

  /**
   * Create a comment on an issue
   */
  async createIssueComment(issueNumber, body) {
    try {
      // Validation checks
      if (!this.octokit) {
        throw new Error('GitHub service not initialized - octokit is null');
      }
      
      if (!this.repository || !this.repository.full_name) {
        throw new Error('Repository not set or missing full_name');
      }
      
      if (!this.config || !this.config.installationToken) {
        throw new Error('GitHub configuration missing or no installation token');
      }
      
      const [owner, repo] = this.repository.full_name.split('/');
      
      console.log('=== CREATE ISSUE COMMENT DEBUG ===');
      console.log(`Repository: ${owner}/${repo}`);
      console.log(`Issue number: ${issueNumber}`);
      console.log(`Body length: ${body?.length || 0}`);
      console.log(`Token available: ${!!this.config.installationToken}`);
      console.log(`Token length: ${this.config.installationToken?.length || 0}`);
      console.log('===================================');
      
      // Ensure body is a string and not too long
      let commentBody = typeof body === 'string' ? body : String(body);
      if (commentBody.length > 65536) {
        console.warn('Comment body too long, truncating to 65536 characters');
        commentBody = commentBody.substring(0, 65533) + '...';
      }
      
      const requestPayload = {
        owner,
        repo,
        issue_number: parseInt(issueNumber, 10),
        body: commentBody
      };
      
      console.log('GitHub API request payload:', JSON.stringify(requestPayload, null, 2));
      
      const response = await this.octokit.rest.issues.createComment(requestPayload);

      console.log(`Comment created successfully on issue #${issueNumber}`);
      console.log(`Comment ID: ${response.data.id}`);
      
      return {
        id: response.data.id,
        html_url: response.data.html_url
      };
    } catch (error) {
      console.error('=== CREATE ISSUE COMMENT ERROR ===');
      console.error('Error details:', {
        message: error.message,
        status: error.status,
        response: error.response?.data,
        request: error.request ? {
          method: error.request.method,
          url: error.request.url,
          headers: error.request.headers
        } : 'No request details'
      });
      console.error('Full error:', error);
      console.error('===================================');
      
      throw new Error(`Issue comment creation failed: ${error.message} (Status: ${error.status || 'unknown'})`);
    }
  }

  /**
   * Get issue details
   */
  async getIssue(issueNumber) {
    try {
      const [owner, repo] = this.repository.full_name.split('/');
      
      const response = await this.octokit.rest.issues.get({
        owner,
        repo,
        issue_number: issueNumber
      });

      return response.data;
    } catch (error) {
      console.error('Failed to get issue:', error);
      throw new Error(`Issue retrieval failed: ${error.message}`);
    }
  }

  /**
   * Get repository information
   */
  async getRepository() {
    try {
      const [owner, repo] = this.repository.full_name.split('/');
      
      const response = await this.octokit.rest.repos.get({
        owner,
        repo
      });

      return response.data;
    } catch (error) {
      console.error('Failed to get repository:', error);
      throw new Error(`Repository retrieval failed: ${error.message}`);
    }
  }

  /**
   * Check if a pull request exists for a branch
   */
  async getPullRequestForBranch(branch) {
    try {
      const [owner, repo] = this.repository.full_name.split('/');
      
      const response = await this.octokit.rest.pulls.list({
        owner,
        repo,
        head: `${owner}:${branch}`,
        state: 'open'
      });

      return response.data.length > 0 ? response.data[0] : null;
    } catch (error) {
      console.error('Failed to check for existing PR:', error);
      return null;
    }
  }

  /**
   * Update pull request
   */
  async updatePullRequest(prNumber, { title, body }) {
    try {
      const [owner, repo] = this.repository.full_name.split('/');
      
      const response = await this.octokit.rest.pulls.update({
        owner,
        repo,
        pull_number: prNumber,
        title,
        body
      });

      console.log(`Pull request #${prNumber} updated`);
      
      return {
        number: response.data.number,
        html_url: response.data.html_url
      };
    } catch (error) {
      console.error('Failed to update pull request:', error);
      throw new Error(`Pull request update failed: ${error.message}`);
    }
  }

  /**
   * Get repository files and structure
   */
  async getRepositoryContents(path = '') {
    try {
      const [owner, repo] = this.repository.full_name.split('/');
      
      const response = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path
      });

      return response.data;
    } catch (error) {
      console.error('Failed to get repository contents:', error);
      throw new Error(`Repository contents retrieval failed: ${error.message}`);
    }
  }

  /**
   * Verify webhook signature (static method for use in main worker)
   */
  static verifyWebhookSignature(payload, signature, secret) {
    
    try {
      // Create HMAC with SHA-256
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(payload, 'utf8');
      
      // Generate expected signature
      const expectedSignature = `sha256=${hmac.digest('hex')}`;
      
      // Use timing-safe comparison
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'utf8'),
        Buffer.from(expectedSignature, 'utf8')
      );
    } catch (error) {
      console.error('Webhook signature verification failed:', error);
      return false;
    }
  }
}