/**
 * Container Service Implementation
 * Provides Durable Object backed container lifecycle operations
 *
 * Implements: IContainerService
 */

import { IContainerService } from '../../core/interfaces/services/container.service';
import { ValidationError } from '../../shared/errors/validation.error';

interface SpawnResponse {
  containerId: string;
  status?: string;
}

interface ExecuteResponse {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Durable Object backed container service
 */
export class ContainerServiceImpl implements IContainerService {
  constructor(private readonly namespace: DurableObjectNamespace) {}

  /**
   * Spawn a new container instance using the container Durable Object
   */
  async spawn(params: {
    configId: string;
    installationId: string;
    userId: string;
    containerImage: string;
    environmentVariables: Record<string, string>;
    resourceLimits: { cpuMillis: number; memoryMb: number; timeoutSeconds: number };
  }): Promise<{ containerId: string }> {
    this.validateSpawnParams(params);

    const containerId = this.generateContainerId(params.configId);
    const sessionId = this.createSessionId(params.installationId, params.userId);
    const expiresAt = Date.now() + params.resourceLimits.timeoutSeconds * 1000;

    const body = {
      containerId,
      sessionId,
      userId: params.userId,
      installationId: params.installationId,
      status: 'starting' as const,
      expiresAt,
      metadata: {
        configId: params.configId,
        containerImage: params.containerImage,
        environmentVariables: params.environmentVariables,
        resourceLimits: params.resourceLimits,
      },
    };

  const response = await this.doRequest('POST', '/container', body, containerId);
    if (!response.ok) {
      throw new Error(`Failed to spawn container: ${response.statusText}`);
    }

    const result = (await response.json()) as SpawnResponse;
    return { containerId: result.containerId ?? containerId };
  }

  /**
   * Execute a command/prompt in a container
   */
  async execute(containerId: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    if (!containerId || !command) {
      throw new ValidationError('containerId and command are required');
    }

    const response = await this.doRequest('POST', '/command', { containerId, command }, containerId);
    if (!response.ok) {
      throw new Error(`Failed to execute command: ${response.statusText}`);
    }

    const result = (await response.json()) as ExecuteResponse;
    return result;
  }

  /**
   * Retrieve container logs
   */
  async getLogs(containerId: string): Promise<string[]> {
    if (!containerId) {
      throw new ValidationError('containerId is required');
    }

    const response = await this.doRequest('GET', '/logs', undefined, containerId, {
      containerId,
    });

    if (!response.ok) {
      throw new Error(`Failed to retrieve logs: ${response.statusText}`);
    }

    return (await response.json()) as string[];
  }

  /**
   * Terminate a container
   */
  async terminate(containerId: string): Promise<void> {
    if (!containerId) {
      throw new ValidationError('containerId is required');
    }

    const response = await this.doRequest('DELETE', '/container', undefined, containerId, {
      containerId,
    });

    if (!response.ok) {
      throw new Error(`Failed to terminate container: ${response.statusText}`);
    }
  }

  /**
   * Check container status
   */
  async getStatus(containerId: string): Promise<'running' | 'stopped' | 'error'> {
    if (!containerId) {
      throw new ValidationError('containerId is required');
    }

    const response = await this.doRequest('GET', '/container', undefined, containerId, {
      containerId,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch container: ${response.statusText}`);
    }

    const data = (await response.json()) as { status?: 'running' | 'stopped' | 'error' } | null;
    if (!data) {
      return 'stopped';
    }

    return data.status ?? 'running';
  }

  private validateSpawnParams(params: {
    configId: string;
    installationId: string;
    userId: string;
    containerImage: string;
    environmentVariables: Record<string, string>;
    resourceLimits: { cpuMillis: number; memoryMb: number; timeoutSeconds: number };
  }): void {
    const required = ['configId', 'installationId', 'userId', 'containerImage'] as const;
    for (const key of required) {
      if (!(params as Record<string, unknown>)[key]) {
        throw new ValidationError(`${key} is required`);
      }
    }

    const { cpuMillis, memoryMb, timeoutSeconds } = params.resourceLimits ?? {};
    if (!cpuMillis || !memoryMb || !timeoutSeconds) {
      throw new ValidationError('resourceLimits must include cpuMillis, memoryMb, timeoutSeconds');
    }
  }

  private generateContainerId(configId: string): string {
    const suffix = Math.random().toString(36).slice(2, 10);
    return `ctr_${configId}_${suffix}`;
  }

  private createSessionId(installationId: string, userId: string): string {
    return `${installationId}:${userId}`;
  }

  private async doRequest(
    method: string,
    path: string,
    body: unknown,
    containerId: string,
    query?: Record<string, string>,
  ): Promise<Response> {
    const id = this.namespace.idFromName(containerId);
    const stub = this.namespace.get(id);

    const url = new URL(`https://container${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    const init: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const request = new Request(url.toString(), init);
    return stub.fetch(request);
  }
}
