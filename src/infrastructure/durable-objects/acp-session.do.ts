/**
 * ACP Session Durable Object
 * Manages Claude AI processing sessions
 */

import { DurableObject } from 'cloudflare:workers';
import { ValidationError } from '../../shared/errors/validation.error';

export interface AcpSession {
  sessionId: string;
  userId: string;
  installationId: string;
  containerId: string;
  status: 'active' | 'paused' | 'completed' | 'failed';
  startedAt: number;
  updatedAt: number;
  expiresAt: number;
  metadata?: Record<string, any>;

  // Coding Mode Configuration
  codingModeEnabled?: boolean;
  selectedRepository?: string;  // "owner/repo"
  selectedBranch?: string;      // target branch (e.g., "main")

  // Persistent Branch Tracking
  workingBranch?: string;       // "feature/chat-abc123-1735488000000"
  branchStatus?: 'active' | 'pr_created' | 'merged' | 'deleted';
  branchCreatedAt?: number;
  lastCommitSha?: string;
  totalCommits?: number;

  // Pull Request Tracking
  pullRequestNumber?: number;
  pullRequestUrl?: string;
}

export class AcpSessionDO extends DurableObject {
  private readonly SESSIONS_PREFIX = 'session:';
  private readonly USER_INDEX_PREFIX = 'user_sessions:';

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
  }

  /**
   * Create a new session
   */
  async createSession(
    session: Omit<AcpSession, 'startedAt' | 'updatedAt'>,
  ): Promise<AcpSession> {
    if (!session.sessionId || !session.userId || !session.installationId) {
      throw new ValidationError(
        'sessionId, userId, and installationId are required',
      );
    }

    try {
      const data: AcpSession = {
        ...session,
        startedAt: Date.now(),
        updatedAt: Date.now(),
      };

      const key = `${this.SESSIONS_PREFIX}${session.sessionId}`;
      await this.ctx.storage.put(key, JSON.stringify(data));

      await this.indexSessionForUser(
        session.userId,
        session.installationId,
        session.sessionId,
        true,
      );

      return data;
    } catch (error) {
      throw new Error(
        `Failed to create session: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<AcpSession | null> {
    if (!sessionId) {
      throw new ValidationError('sessionId is required');
    }

    try {
      const key = `${this.SESSIONS_PREFIX}${sessionId}`;
      const value = await this.ctx.storage.get(key);
      if (!value) {
        return null;
      }

      const session = JSON.parse(value as string) as AcpSession;
      if (session.expiresAt <= Date.now()) {
        await this.ctx.storage.delete(key);
        await this.indexSessionForUser(
          session.userId,
          session.installationId,
          sessionId,
          false,
        );
        return null;
      }

      return session;
    } catch (error) {
      throw new Error(
        `Failed to get session: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Update session status
   */
  async updateSessionStatus(
    sessionId: string,
    status: AcpSession['status'],
    metadata?: Record<string, any>,
  ): Promise<void> {
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        throw new ValidationError('Session not found');
      }

      session.status = status;
      session.updatedAt = Date.now();
      if (metadata) {
        session.metadata = metadata;
      }

      const key = `${this.SESSIONS_PREFIX}${sessionId}`;
      await this.ctx.storage.put(key, JSON.stringify(session));
    } catch (error) {
      throw new Error(
        `Failed to update session: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * List user's active sessions
   */
  async listUserSessions(
    userId: string,
    installationId: string,
  ): Promise<AcpSession[]> {
    if (!userId || !installationId) {
      throw new ValidationError('userId and installationId are required');
    }

    try {
      const indexKey = `${this.USER_INDEX_PREFIX}${installationId}:${userId}`;
      const indexValue = await this.ctx.storage.get(indexKey);

      if (!indexValue) {
        return [];
      }

      const sessionIds: string[] = JSON.parse(indexValue as string);
      const sessions: AcpSession[] = [];

      for (const sessionId of sessionIds) {
        const session = await this.getSession(sessionId);
        if (session && session.status === 'active') {
          sessions.push(session);
        }
      }

      return sessions;
    } catch (error) {
      throw new Error(
        `Failed to list sessions: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Delete session
   */
  async deleteSession(
    sessionId: string,
    userId: string,
    installationId: string,
  ): Promise<void> {
    try {
      const key = `${this.SESSIONS_PREFIX}${sessionId}`;
      await this.ctx.storage.delete(key);
      await this.indexSessionForUser(userId, installationId, sessionId, false);
    } catch (error) {
      throw new Error(
        `Failed to delete session: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Update coding mode configuration
   */
  async updateCodingMode(
    sessionId: string,
    config: {
      codingModeEnabled: boolean;
      selectedRepository?: string;
      selectedBranch?: string;
      workingBranch?: string;
    },
  ): Promise<void> {
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        throw new ValidationError('Session not found');
      }

      session.codingModeEnabled = config.codingModeEnabled;
      session.updatedAt = Date.now();

      if (config.selectedRepository) {
        session.selectedRepository = config.selectedRepository;
      }
      if (config.selectedBranch) {
        session.selectedBranch = config.selectedBranch;
      }
      if (config.workingBranch) {
        session.workingBranch = config.workingBranch;
        session.branchStatus = 'active';
        session.branchCreatedAt = Date.now();
        session.totalCommits = 0;
      }

      const key = `${this.SESSIONS_PREFIX}${sessionId}`;
      await this.ctx.storage.put(key, JSON.stringify(session));
    } catch (error) {
      throw new Error(
        `Failed to update coding mode: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Update commit tracking after successful commit
   */
  async updateCommitTracking(
    sessionId: string,
    commitSha: string,
  ): Promise<void> {
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        throw new ValidationError('Session not found');
      }

      session.lastCommitSha = commitSha;
      session.totalCommits = (session.totalCommits || 0) + 1;
      session.updatedAt = Date.now();

      const key = `${this.SESSIONS_PREFIX}${sessionId}`;
      await this.ctx.storage.put(key, JSON.stringify(session));
    } catch (error) {
      throw new Error(
        `Failed to update commit tracking: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Update PR tracking after PR creation
   */
  async updatePRTracking(
    sessionId: string,
    pullRequestNumber: number,
    pullRequestUrl: string,
  ): Promise<void> {
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        throw new ValidationError('Session not found');
      }

      session.pullRequestNumber = pullRequestNumber;
      session.pullRequestUrl = pullRequestUrl;
      session.branchStatus = 'pr_created';
      session.updatedAt = Date.now();

      const key = `${this.SESSIONS_PREFIX}${sessionId}`;
      await this.ctx.storage.put(key, JSON.stringify(session));
    } catch (error) {
      throw new Error(
        `Failed to update PR tracking: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private async indexSessionForUser(
    userId: string,
    installationId: string,
    sessionId: string,
    add: boolean,
  ): Promise<void> {
    try {
      const indexKey = `${this.USER_INDEX_PREFIX}${installationId}:${userId}`;
      const indexValue = await this.ctx.storage.get(indexKey);

      let sessionIds: string[] = indexValue
        ? JSON.parse(indexValue as string)
        : [];

      if (add && !sessionIds.includes(sessionId)) {
        sessionIds.push(sessionId);
      } else if (!add) {
        sessionIds = sessionIds.filter((id) => id !== sessionId);
      }

      await this.ctx.storage.put(indexKey, JSON.stringify(sessionIds));
    } catch (error) {
      console.error(
        `Failed to index session: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * HTTP handler
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/session') {
      try {
        const session =
          await request.json<Omit<AcpSession, 'startedAt' | 'updatedAt'>>();
        const created = await this.createSession(session);
        return new Response(JSON.stringify(created), { status: 201 });
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 400,
          },
        );
      }
    }

    if (request.method === 'GET' && url.pathname === '/session') {
      try {
        const sessionId = url.searchParams.get('sessionId');
        if (!sessionId) {
          return new Response(JSON.stringify({ error: 'sessionId required' }), {
            status: 400,
          });
        }
        const session = await this.getSession(sessionId);
        return new Response(JSON.stringify(session), { status: 200 });
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 500,
          },
        );
      }
    }

    if (request.method === 'PUT' && url.pathname === '/session') {
      try {
        const { sessionId, status, metadata } = await request.json<{
          sessionId: string;
          status: AcpSession['status'];
          metadata?: Record<string, any>;
        }>();
        await this.updateSessionStatus(sessionId, status, metadata);
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 400,
          },
        );
      }
    }

    if (request.method === 'GET' && url.pathname === '/sessions') {
      try {
        const userId = url.searchParams.get('userId');
        const installationId = url.searchParams.get('installationId');
        if (!userId || !installationId) {
          return new Response(
            JSON.stringify({ error: 'userId and installationId required' }),
            { status: 400 },
          );
        }
        const sessions = await this.listUserSessions(userId, installationId);
        return new Response(JSON.stringify(sessions), { status: 200 });
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 500,
          },
        );
      }
    }

    if (request.method === 'PATCH' && url.pathname === '/session/coding-mode') {
      try {
        const { sessionId, ...config } = await request.json<{
          sessionId: string;
          codingModeEnabled: boolean;
          selectedRepository?: string;
          selectedBranch?: string;
          workingBranch?: string;
        }>();
        await this.updateCodingMode(sessionId, config);
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 400,
          },
        );
      }
    }

    if (request.method === 'PATCH' && url.pathname === '/session/commit-tracking') {
      try {
        const { sessionId, commitSha } = await request.json<{
          sessionId: string;
          commitSha: string;
        }>();
        await this.updateCommitTracking(sessionId, commitSha);
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 400,
          },
        );
      }
    }

    if (request.method === 'PATCH' && url.pathname === '/session/pr-tracking') {
      try {
        const { sessionId, pullRequestNumber, pullRequestUrl } = await request.json<{
          sessionId: string;
          pullRequestNumber: number;
          pullRequestUrl: string;
        }>();
        await this.updatePRTracking(sessionId, pullRequestNumber, pullRequestUrl);
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 400,
          },
        );
      }
    }

    // Update session containerId
    if (request.method === 'PATCH' && url.pathname === '/session') {
      try {
        const { sessionId, containerId } = await request.json<{
          sessionId: string;
          containerId: string;
        }>();
        const session = await this.getSession(sessionId);
        if (!session) {
          return new Response(
            JSON.stringify({ error: 'Session not found' }),
            { status: 404 },
          );
        }
        session.containerId = containerId;
        session.updatedAt = Date.now();
        const key = `${this.SESSIONS_PREFIX}${sessionId}`;
        await this.ctx.storage.put(key, JSON.stringify(session));
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 400,
          },
        );
      }
    }

    return new Response('Not Found', { status: 404 });
  }
}
