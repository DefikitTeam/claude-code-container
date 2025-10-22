/**
 * Container Durable Object
 * Manages ephemeral container lifecycle and execution
 */

import { DurableObject } from 'cloudflare:workers';
import { ValidationError } from '../../shared/errors/validation.error';

interface ContainerInstance {
  containerId: string;
  sessionId: string;
  userId: string;
  installationId: string;
  status: 'starting' | 'running' | 'paused' | 'stopped' | 'error';
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  logs: string[];
  metadata?: Record<string, any>;
}

export class ContainerDO extends DurableObject {
  private readonly CONTAINER_PREFIX = 'container:';
  private readonly LOGS_PREFIX = 'logs:';
  private readonly SESSION_INDEX_PREFIX = 'session_containers:';

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
  }

  /**
   * Spawn a new container
   */
  async spawnContainer(container: Omit<ContainerInstance, 'createdAt' | 'updatedAt' | 'logs'>): Promise<ContainerInstance> {
    if (!container.containerId || !container.sessionId) {
      throw new ValidationError('containerId and sessionId are required');
    }

    try {
      const data: ContainerInstance = {
        ...container,
        status: 'starting',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        logs: [],
      };

      const key = `${this.CONTAINER_PREFIX}${container.containerId}`;
      await this.ctx.storage.put(key, JSON.stringify(data));

      await this.indexContainerForSession(container.sessionId, container.containerId, true);

      return data;
    } catch (error) {
      throw new Error(`Failed to spawn container: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get container by ID
   */
  async getContainer(containerId: string): Promise<ContainerInstance | null> {
    if (!containerId) {
      throw new ValidationError('containerId is required');
    }

    try {
      const key = `${this.CONTAINER_PREFIX}${containerId}`;
      const value = await this.ctx.storage.get(key);
      if (!value) {
        return null;
      }

      const container = JSON.parse(value as string) as ContainerInstance;
      if (container.expiresAt <= Date.now()) {
        await this.ctx.storage.delete(key);
        await this.indexContainerForSession(container.sessionId, containerId, false);
        return null;
      }

      return container;
    } catch (error) {
      throw new Error(`Failed to get container: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update container status
   */
  async updateStatus(containerId: string, status: ContainerInstance['status']): Promise<void> {
    try {
      const container = await this.getContainer(containerId);
      if (!container) {
        throw new ValidationError('Container not found');
      }

      container.status = status;
      container.updatedAt = Date.now();

      const key = `${this.CONTAINER_PREFIX}${containerId}`;
      await this.ctx.storage.put(key, JSON.stringify(container));
    } catch (error) {
      throw new Error(`Failed to update status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Add log entry
   */
  async addLog(containerId: string, message: string): Promise<void> {
    try {
      const container = await this.getContainer(containerId);
      if (!container) {
        throw new ValidationError('Container not found');
      }

      container.logs.push(`[${new Date().toISOString()}] ${message}`);
      container.updatedAt = Date.now();

      const key = `${this.CONTAINER_PREFIX}${containerId}`;
      await this.ctx.storage.put(key, JSON.stringify(container));
    } catch (error) {
      throw new Error(`Failed to add log: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get logs for container
   */
  async getLogs(containerId: string, limit: number = 100): Promise<string[]> {
    try {
      const container = await this.getContainer(containerId);
      if (!container) {
        return [];
      }

      return container.logs.slice(-limit);
    } catch (error) {
      throw new Error(`Failed to get logs: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List containers for a session
   */
  async listSessionContainers(sessionId: string): Promise<ContainerInstance[]> {
    if (!sessionId) {
      throw new ValidationError('sessionId is required');
    }

    try {
      const indexKey = `${this.SESSION_INDEX_PREFIX}${sessionId}`;
      const indexValue = await this.ctx.storage.get(indexKey);

      if (!indexValue) {
        return [];
      }

      const containerIds: string[] = JSON.parse(indexValue as string);
      const containers: ContainerInstance[] = [];

      for (const containerId of containerIds) {
        const container = await this.getContainer(containerId);
        if (container) {
          containers.push(container);
        }
      }

      return containers;
    } catch (error) {
      throw new Error(`Failed to list containers: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Terminate container
   */
  async terminateContainer(containerId: string, sessionId: string): Promise<void> {
    try {
      await this.updateStatus(containerId, 'stopped');
      const key = `${this.CONTAINER_PREFIX}${containerId}`;
      await this.ctx.storage.delete(key);
      await this.indexContainerForSession(sessionId, containerId, false);
    } catch (error) {
      throw new Error(`Failed to terminate container: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async indexContainerForSession(sessionId: string, containerId: string, add: boolean): Promise<void> {
    try {
      const indexKey = `${this.SESSION_INDEX_PREFIX}${sessionId}`;
      const indexValue = await this.ctx.storage.get(indexKey);

      let containerIds: string[] = indexValue ? JSON.parse(indexValue as string) : [];

      if (add && !containerIds.includes(containerId)) {
        containerIds.push(containerId);
      } else if (!add) {
        containerIds = containerIds.filter((id) => id !== containerId);
      }

      await this.ctx.storage.put(indexKey, JSON.stringify(containerIds));
    } catch (error) {
      console.error(`Failed to index container: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * HTTP handler
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/container') {
      try {
  const container = await request.json<Omit<ContainerInstance, 'createdAt' | 'updatedAt' | 'logs'>>();
  const spawned = await this.spawnContainer(container);
        return new Response(JSON.stringify(spawned), { status: 201 });
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
          status: 400,
        });
      }
    }

    if (request.method === 'GET' && url.pathname === '/container') {
      try {
        const containerId = url.searchParams.get('containerId');
        if (!containerId) {
          return new Response(JSON.stringify({ error: 'containerId required' }), { status: 400 });
        }
        const container = await this.getContainer(containerId);
        return new Response(JSON.stringify(container), { status: 200 });
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
          status: 500,
        });
      }
    }

    if (request.method === 'PUT' && url.pathname === '/container') {
      try {
        const { containerId, status } = await request.json<{
          containerId: string;
          status: ContainerInstance['status'];
        }>();
        await this.updateStatus(containerId, status);
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
          status: 400,
        });
      }
    }

    if (request.method === 'POST' && url.pathname === '/log') {
      try {
        const { containerId, message } = await request.json<{
          containerId: string;
          message: string;
        }>();
        await this.addLog(containerId, message);
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
          status: 400,
        });
      }
    }

    if (request.method === 'GET' && url.pathname === '/logs') {
      try {
        const containerId = url.searchParams.get('containerId');
        const limit = parseInt(url.searchParams.get('limit') || '100', 10);
        if (!containerId) {
          return new Response(JSON.stringify({ error: 'containerId required' }), { status: 400 });
        }
        const logs = await this.getLogs(containerId, limit);
        return new Response(JSON.stringify(logs), { status: 200 });
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
          status: 500,
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  }
}
