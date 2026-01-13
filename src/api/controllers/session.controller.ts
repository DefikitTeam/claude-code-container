import type { Context } from 'hono';
import {
  EnableCodingModeUseCase,
  type EnableCodingModeResult,
} from '../../core/use-cases/session/enable-coding-mode.use-case';
import {
  ProcessSessionPromptUseCase,
  type ProcessSessionPromptResult,
} from '../../core/use-cases/session/process-session-prompt.use-case';
import {
  CreatePRFromSessionUseCase,
  type CreatePRFromSessionResult,
} from '../../core/use-cases/session/create-pr-from-session.use-case';
import {
  createdResponse,
  successResponse,
} from '../responses/success.response';

interface EnableCodingModeRequestBody {
  selectedRepository: string;
  selectedBranch?: string;
  workingBranch?: string; // Optional custom branch name
}

interface ProcessPromptRequestBody {
  prompt: string;
  githubToken: string;
}

interface CreatePRRequestBody {
  title?: string;
  description?: string;
}

export class SessionController {
  constructor(
    private readonly enableCodingModeUseCase: EnableCodingModeUseCase,
    private readonly processSessionPromptUseCase: ProcessSessionPromptUseCase,
    private readonly createPRFromSessionUseCase: CreatePRFromSessionUseCase,
  ) {}

  /**
   * Enable coding mode on a session
   * POST /api/sessions/:sessionId/coding-mode
   */
  async enableCodingMode(c: Context): Promise<Response> {
    const sessionId = c.req.param('sessionId');
    const userId = this.safeGet<string>(c, 'userId');
    const installationId = this.safeGet<string>(c, 'installationId');

    if (!userId || !installationId) {
      return c.json(
        { error: 'userId and installationId are required' },
        400,
      );
    }

    const body = await this.parseJson<EnableCodingModeRequestBody>(c);

    const result = await this.enableCodingModeUseCase.execute({
      sessionId,
      userId,
      installationId,
      selectedRepository: body.selectedRepository,
      selectedBranch: body.selectedBranch,
      workingBranch: body.workingBranch,
    });

    return successResponse<EnableCodingModeResult>(c, result);
  }

  /**
   * Process a prompt in coding mode (creates a commit)
   * POST /api/sessions/:sessionId/prompt
   */
  async processPrompt(c: Context): Promise<Response> {
    const sessionId = c.req.param('sessionId');
    const userId = this.safeGet<string>(c, 'userId');
    const installationId = this.safeGet<string>(c, 'installationId');

    if (!userId || !installationId) {
      return c.json(
        { error: 'userId and installationId are required' },
        400,
      );
    }

    const body = await this.parseJson<ProcessPromptRequestBody>(c);

    const result = await this.processSessionPromptUseCase.execute({
      sessionId,
      userId,
      installationId,
      prompt: body.prompt,
      githubToken: body.githubToken,
    });

    return successResponse<ProcessSessionPromptResult>(c, result);
  }

  /**
   * Create a PR from the session's working branch
   * POST /api/sessions/:sessionId/pull-request
   */
  async createPullRequest(c: Context): Promise<Response> {
    const sessionId = c.req.param('sessionId');
    const userId = this.safeGet<string>(c, 'userId');
    const installationId = this.safeGet<string>(c, 'installationId');

    if (!userId || !installationId) {
      return c.json(
        { error: 'userId and installationId are required' },
        400,
      );
    }

    const body = await this.parseJson<CreatePRRequestBody>(c);

    const result = await this.createPRFromSessionUseCase.execute({
      sessionId,
      userId,
      installationId,
      title: body.title,
      description: body.description,
    });

    return createdResponse<CreatePRFromSessionResult>(c, result);
  }

  /**
   * Update PR tracking (called by Lumi BE after creating PR in GitHub)
   * PATCH /api/sessions/:sessionId/pr-tracking
   */
  async updatePRTracking(c: Context): Promise<Response> {
    const sessionId = c.req.param('sessionId');
    const userId = this.safeGet<string>(c, 'userId');
    const installationId = this.safeGet<string>(c, 'installationId');

    if (!userId || !installationId) {
      return c.json(
        { error: 'userId and installationId are required' },
        400,
      );
    }

    const body = await this.parseJson<{
      pullRequestNumber: number;
      pullRequestUrl: string;
    }>(c);

    // Update session in Durable Object
    const env = c.env as Env;
    const sessionDO = env.ACP_SESSION.idFromName(sessionId);
    const sessionStub = env.ACP_SESSION.get(sessionDO);
    const response = await sessionStub.fetch(
      'http://do/session/pr-tracking',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          pullRequestNumber: body.pullRequestNumber,
          pullRequestUrl: body.pullRequestUrl,
        }),
      },
    );

    if (!response.ok) {
      return c.json({ error: 'Failed to update PR tracking' }, 500);
    }

    return successResponse(c, { success: true });
  }

  /**
   * Get session status and branch information
   * GET /api/sessions/:sessionId/status
   */
  async getSessionStatus(c: Context): Promise<Response> {
    const sessionId = c.req.param('sessionId');
    const userId = this.safeGet<string>(c, 'userId');
    const installationId = this.safeGet<string>(c, 'installationId');

    if (!userId || !installationId) {
      return c.json(
        { error: 'userId and installationId are required' },
        400,
      );
    }

    // Get session from Durable Object
    const env = c.env as Env;
    const sessionDO = env.ACP_SESSION.idFromName(sessionId);
    const sessionStub = env.ACP_SESSION.get(sessionDO);
    const sessionResponse = await sessionStub.fetch(
      `http://do/session?sessionId=${sessionId}`,
    );

    if (!sessionResponse.ok) {
      return c.json({ error: 'Session not found' }, 404);
    }

    const session = await sessionResponse.json();

    return successResponse(c, {
      sessionId: session.sessionId,
      status: session.status,
      codingModeEnabled: session.codingModeEnabled || false,
      selectedRepository: session.selectedRepository,
      selectedBranch: session.selectedBranch,
      workingBranch: session.workingBranch,
      branchStatus: session.branchStatus,
      totalCommits: session.totalCommits || 0,
      lastCommitSha: session.lastCommitSha,
      pullRequestNumber: session.pullRequestNumber,
      pullRequestUrl: session.pullRequestUrl,
      createdAt: session.startedAt,
      updatedAt: session.updatedAt,
    });
  }

  private async parseJson<T>(c: Context): Promise<T> {
    try {
      return (await c.req.json()) as T;
    } catch (error) {
      throw error;
    }
  }

  private safeGet<T>(c: Context, key: string): T | undefined {
    try {
      return c.get(key) as T | undefined;
    } catch {
      return undefined;
    }
  }
}
