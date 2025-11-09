import { Context } from 'hono';
import { ProcessWebhookUseCase } from '../../core/use-cases/github/process-webhook.use-case';
import { FetchRepositoriesUseCase } from '../../core/use-cases/github/fetch-repositories.use-case';
import { FetchBranchesUseCase } from '../../core/use-cases/github/fetch-branches.use-case';
import { CreatePullRequestUseCase } from '../../core/use-cases/github/create-pull-request.use-case';
import { parseWebhookPayloadDTO } from '../dto/webhook-payload.dto';
import { parseCreatePRDTO } from '../dto/create-pr.dto';
import { successResponse } from '../responses/success.response';
import { errorResponse } from '../responses/error.response';
import { ValidationError } from '../../shared/errors/validation.error';

export class GitHubController {
  constructor(
    private processWebhookUseCase: ProcessWebhookUseCase,
    private fetchRepositoriesUseCase: FetchRepositoriesUseCase,
    private fetchBranchesUseCase: FetchBranchesUseCase,
    private createPullRequestUseCase: CreatePullRequestUseCase,
  ) {}

  async processWebhook(c: Context) {
    try {
      const installationId = c.req.header('x-installation-id')!;
      const body = await c.req.json();
      const webhookData = parseWebhookPayloadDTO(body);

      const result = await this.processWebhookUseCase.execute({
        installationId,
        eventType: webhookData.event,
        payload: webhookData.payload,
        env: c.env, // Pass environment bindings
      });

      return successResponse(c, result, 200);
    } catch (err: any) {
      return errorResponse(c, err);
    }
  }

  async fetchRepositories(c: Context) {
    try {
      const installationId = c.req.header('x-installation-id')!;

  const result = await this.fetchRepositoriesUseCase.execute({ installationId });

  return successResponse(c, result, 200);
    } catch (err: any) {
      return errorResponse(c, err);
    }
  }

  async fetchBranches(c: Context) {
    try {
      const installationId = c.req.header('x-installation-id')!;
      const repository = c.req.param('repository');

      if (!repository) {
        throw new ValidationError('Repository parameter required');
      }

      // Parse owner/repo format
      const [owner, repo] = repository.split('/');
      if (!owner || !repo) {
        throw new ValidationError('Repository must be in owner/repo format');
      }

      const result = await this.fetchBranchesUseCase.execute({
        owner,
        repo,
        installationId,
      });

      return successResponse(c, result, 200);
    } catch (err: any) {
      return errorResponse(c, err);
    }
  }

  async createPullRequest(c: Context) {
    try {
      const installationId = c.req.header('x-installation-id')!;
      const body = await c.req.json();
      const prData = parseCreatePRDTO(body, installationId);

      const pullRequest = await this.createPullRequestUseCase.execute(prData);

      return successResponse(c, { pullRequest }, 201);
    } catch (err: any) {
      return errorResponse(c, err);
    }
  }
}
