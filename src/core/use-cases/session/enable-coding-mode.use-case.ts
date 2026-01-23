import { ValidationError } from '../../../shared/errors/validation.error';

export interface EnableCodingModeDto {
  sessionId: string;
  userId: string;
  installationId: string;
  selectedRepository: string; // Format: "owner/repo"
  selectedBranch?: string; // Default: "main"
  workingBranch?: string; // Optional custom branch name
}

export interface EnableCodingModeResult {
  success: boolean;
  sessionId: string;
  workingBranch: string;
  selectedRepository: string;
  selectedBranch: string;
  codingModeEnabled: boolean;
}

/**
 * Enable Coding Mode Use Case
 * Enables coding mode on a session and generates a persistent working branch
 */
export class EnableCodingModeUseCase {
  constructor(private readonly env: Env) {}

  async execute(dto: EnableCodingModeDto): Promise<EnableCodingModeResult> {
    // Validate input
    if (!dto.sessionId || !dto.selectedRepository) {
      throw new ValidationError(
        'sessionId and selectedRepository are required',
      );
    }

    // Validate repository format
    const [owner, repo] = dto.selectedRepository.split('/');
    if (!owner || !repo) {
      throw new ValidationError(
        'selectedRepository must be in format "owner/repo"',
      );
    }

    const selectedBranch = dto.selectedBranch || 'main';

    // Generate working branch name or use provided one
    const workingBranch =
      dto.workingBranch || this.generateWorkingBranchName(dto.sessionId);

    // Get session from Durable Object
    const sessionDO = this.env.ACP_SESSION.idFromName(dto.sessionId);
    const sessionStub = this.env.ACP_SESSION.get(sessionDO);

    // Try to get existing session
    const sessionResponse = await sessionStub.fetch(
      `http://do/session?sessionId=${dto.sessionId}`,
    );

    let session: any = null;
    if (sessionResponse.ok) {
      session = await sessionResponse.json<any>();
    }

    // If session exists and coding mode is already enabled, return existing config
    // UNLESS we are explicitly resetting/updating it with a new branch
    // Note: The logic here prioritizes existing session state if it matches what we want,
    // but if we are "resetting" (create-dual call), we usually want to force the new state.
    // However, create-dual only calls this once.
    if (session?.codingModeEnabled && session?.workingBranch) {
      // If the session already has a working branch, and it's DIFFERENT from the requested one,
      // we should probably update it.
      // But for safety in this specific "Enable" use case, let's update it if provided.
      if (dto.workingBranch && session.workingBranch !== dto.workingBranch) {
        // Fall through to update logic
      } else {
        return {
          success: true,
          sessionId: dto.sessionId,
          workingBranch: session.workingBranch,
          selectedRepository: session.selectedRepository,
          selectedBranch: session.selectedBranch,
          codingModeEnabled: true,
        };
      }
    }

    // If session doesn't exist, create it with coding mode enabled
    if (!session) {
      const createResponse = await sessionStub.fetch('http://do/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: dto.sessionId,
          userId: dto.userId,
          installationId: dto.installationId,
          containerId: '', // Will be assigned when container starts
          status: 'active',
          expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
          codingModeEnabled: true,
          selectedRepository: dto.selectedRepository,
          selectedBranch,
          workingBranch,
          branchStatus: 'active',
          branchCreatedAt: Date.now(),
          totalCommits: 0,
        }),
      });

      if (!createResponse.ok) {
        const error = await createResponse.text();
        throw new Error(`Failed to create session: ${error}`);
      }
    } else {
      // Session exists but coding mode not enabled - update it
      const updateResponse = await sessionStub.fetch(
        'http://do/session/coding-mode',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: dto.sessionId,
            codingModeEnabled: true,
            selectedRepository: dto.selectedRepository,
            selectedBranch,
            workingBranch,
          }),
        },
      );

      if (!updateResponse.ok) {
        const error = await updateResponse.text();
        throw new Error(`Failed to enable coding mode on session: ${error}`);
      }
    }

    return {
      success: true,
      sessionId: dto.sessionId,
      workingBranch,
      selectedRepository: dto.selectedRepository,
      selectedBranch,
      codingModeEnabled: true,
    };
  }

  /**
   * Generate a unique working branch name for the session
   * Format: feature/chat-{shortSessionId}-{timestamp}
   */
  private generateWorkingBranchName(sessionId: string): string {
    const timestamp = Date.now();
    const shortSessionId = sessionId.substring(0, 8);
    return `feature/chat-${shortSessionId}-${timestamp}`;
  }
}
