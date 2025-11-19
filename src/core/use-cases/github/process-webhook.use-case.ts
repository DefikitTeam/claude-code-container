import { IGitHubService } from '../../interfaces/services/github.service';
import { ValidationError } from '../../../shared/errors/validation.error';
import { NotFoundError } from '../../../shared/errors/not-found.error';

export interface ProcessWebhookDto {
  installationId: string;
  eventType: string;
  payload: any;
  env: any; // Worker environment bindings
  userConfig?: any; // User configuration (if already loaded)
}

export interface ProcessWebhookResult {
  processed: boolean;
  message: string;
  containerId?: string;
  containerStatus?: number;
}

/**
 * Process GitHub Webhook Use Case
 * Handles GitHub webhook events and routes to container processing
 */
export class ProcessWebhookUseCase {
  constructor(private readonly githubService: IGitHubService) {}

  async execute(dto: ProcessWebhookDto): Promise<ProcessWebhookResult> {
    if (!dto.installationId || !dto.eventType) {
      throw new ValidationError('installationId and eventType are required');
    }

    console.log(
      `[WEBHOOK] Processing ${dto.eventType} event for installation ${dto.installationId}`,
    );

    // Validate installation
    const isValid = await this.githubService.validateInstallation(
      dto.installationId,
    );
    if (!isValid) {
      throw new NotFoundError(
        `Installation ${dto.installationId} not found or inactive`,
      );
    }

    // Process based on event type
    switch (dto.eventType) {
      case 'issues':
        return await this.handleIssueEvent(dto);
      case 'pull_request':
        return await this.handlePullRequestEvent(dto);
      case 'ping':
        console.log('[WEBHOOK] GitHub webhook ping received');
        return { processed: true, message: 'pong' };
      case 'installation':
      case 'installation_repositories':
        return await this.handleInstallationEvent(dto);
      default:
        console.log(`[WEBHOOK] Unhandled event type: ${dto.eventType}`);
        return {
          processed: false,
          message: `Event type '${dto.eventType}' not supported`,
        };
    }
  }

  /**
   * Handle GitHub issue events (opened, closed, etc.)
   */
  private async handleIssueEvent(
    dto: ProcessWebhookDto,
  ): Promise<ProcessWebhookResult> {
    const { action, issue, repository, installation } = dto.payload;

    console.log(
      `[WEBHOOK] Issue event: ${action} - #${issue.number} in ${repository.full_name}`,
    );

    // Only process opened issues
    if (action !== 'opened') {
      console.log(`[WEBHOOK] Ignoring issue action: ${action}`);
      return {
        processed: false,
        message: `Issue action '${action}' not processed`,
      };
    }

    // Skip processing issues created by bots to avoid loops
    if (issue.user.login.includes('[bot]') || issue.user.login === 'claude') {
      console.log('[WEBHOOK] Skipping bot-created issue');
      return { processed: false, message: 'Bot issue skipped' };
    }

    // Get user configuration for this installation
    if (!dto.userConfig) {
      throw new NotFoundError(
        `No user configuration found for installation ${dto.installationId}. User must register first.`,
      );
    }

    // Get container to process the issue
    const containerId = dto.env.MY_CONTAINER.idFromName(`issue-${issue.id}`);
    const container = dto.env.MY_CONTAINER.get(containerId);

    // Prepare container request
    const containerRequest = {
      type: 'process_issue',
      payload: dto.payload,
      config: {
        appId: dto.env.FIXED_GITHUB_APP_ID || '',
        installationId: dto.installationId,
        userId: dto.userConfig.userId,
      },
    };

    console.log(`[WEBHOOK] Sending issue to container for processing`);

    // Send request to container with user's Anthropic API key
    const containerResponse = await container.fetch(
      new Request('https://container/process-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(containerRequest),
      }),
      {
        env: {
          ANTHROPIC_API_KEY: dto.userConfig.anthropicApiKey,
          USER_ID: dto.userConfig.userId,
        },
      },
    );

    console.log(
      `[WEBHOOK] Container response status: ${containerResponse.status}`,
    );

    if (containerResponse.status === 503) {
      console.error(
        '[WEBHOOK] Container unavailable (503) - provisioning may be in progress',
      );
      throw new Error(
        'Container service temporarily unavailable. Please retry in a few moments.',
      );
    }

    if (!containerResponse.ok) {
      const errorText = await containerResponse.text();
      console.error('[WEBHOOK] Container processing failed:', errorText);
      throw new Error(`Container processing failed: ${errorText}`);
    }

    return {
      processed: true,
      message: 'Issue event processed successfully',
      containerId: `issue-${issue.id}`,
      containerStatus: containerResponse.status,
    };
  }

  /**
   * Handle GitHub pull request events
   */
  private async handlePullRequestEvent(
    dto: ProcessWebhookDto,
  ): Promise<ProcessWebhookResult> {
    const { action, pull_request } = dto.payload;

    console.log(
      `[WEBHOOK] Pull request event: ${action} - #${pull_request.number}`,
    );

    // For now, just acknowledge the event
    // Full PR processing can be added later
    return {
      processed: true,
      message: `Pull request ${action} event acknowledged`,
    };
  }

  /**
   * Handle installation events (installed, uninstalled, etc.)
   */
  private async handleInstallationEvent(
    dto: ProcessWebhookDto,
  ): Promise<ProcessWebhookResult> {
    const { action, installation } = dto.payload;

    console.log(
      `[WEBHOOK] Installation event: ${action} - ID ${installation.id}`,
    );

    // Log installation changes but don't process further
    // User registration/unregistration is handled via API endpoints
    return {
      processed: true,
      message: `Installation ${action} event acknowledged`,
    };
  }
}
