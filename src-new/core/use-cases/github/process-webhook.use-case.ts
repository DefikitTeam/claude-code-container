import { IGitHubService } from '../../interfaces/services/github.service';
import { ValidationError } from '../../../shared/errors/validation.error';
import { NotFoundError } from '../../../shared/errors/not-found.error';

export interface ProcessWebhookDto {
  installationId: string;
  eventType: string;
  payload: any;
}

export interface ProcessWebhookResult {
  processed: boolean;
  message: string;
}

/**
 * Process GitHub Webhook Use Case
 * Handles GitHub webhook events
 */
export class ProcessWebhookUseCase {
  constructor(private readonly githubService: IGitHubService) {}

  async execute(dto: ProcessWebhookDto): Promise<ProcessWebhookResult> {
    if (!dto.installationId || !dto.eventType) {
      throw new ValidationError('installationId and eventType are required');
    }

    // Validate installation
    const isValid = await this.githubService.validateInstallation(dto.installationId);
    if (!isValid) {
      throw new NotFoundError(`Installation ${dto.installationId} not found`);
    }

    // Process based on event type
    switch (dto.eventType) {
      case 'issues':
        // Handle issue events
        return { processed: true, message: 'Issue event processed' };
      case 'pull_request':
        // Handle PR events
        return { processed: true, message: 'Pull request event processed' };
      default:
        return { processed: false, message: `Unknown event type: ${dto.eventType}` };
    }
  }
}
