import { IContainerService } from '../../core/interfaces/services/container.service';
import { ValidationError } from '../../shared/errors/validation.error';

const PROVISION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for create/delete
const EXECUTE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes for execute/status
const PROCESS_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes for forwarding commands

interface DaytonaWorkspaceDto {
  id: string;
  configId: string;
  status: string;
  publicUrl: string;
  ports?: Record<string, string>;
}

interface DaytonaWorkspacesResponse {
  workspaces?: DaytonaWorkspaceDto[];
}

interface DaytonaLogsResponse {
  logs: string[];
}

export class DaytonaContainerService implements IContainerService {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
  ) {
    if (!apiUrl || !apiKey) {
      throw new ValidationError('Daytona API URL and key are required');
    }
  }

  async spawn(params: {
    configId: string;
    installationId: string;
    userId: string;
    containerImage: string;
    environmentVariables: Record<string, string>;
    resourceLimits: {
      cpuMillis: number;
      memoryMb: number;
      timeoutSeconds: number;
    };
  }): Promise<{ containerId: string }> {
    this.validateSpawnParams(params);

    const existingWorkspace = await this.findExistingWorkspace(
      params.configId,
    );

    if (existingWorkspace && this.isWorkspaceHealthy(existingWorkspace)) {
      return { containerId: this.toContainerId(existingWorkspace.id) };
    }

    const payload = {
      configId: params.configId,
      installationId: params.installationId,
      userId: params.userId,
      image: params.containerImage,
      env: params.environmentVariables,
      resources: params.resourceLimits,
    };

    const workspace = await this.doRequest<DaytonaWorkspaceDto>(
      'POST',
      '/workspaces',
      payload,
      PROVISION_TIMEOUT_MS,
    );

    return { containerId: this.toContainerId(workspace.id) };
  }

  async execute(
    containerId: string,
    command: string,
  ): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    if (!containerId || !command) {
      throw new ValidationError('containerId and command are required');
    }

    const workspace = await this.getWorkspace(containerId, EXECUTE_TIMEOUT_MS);
    const processUrl = this.getProcessUrl(workspace);

    if (!processUrl) {
      throw new Error('Daytona workspace has no public endpoint');
    }

    const response = await this.fetchWithTimeout(
      `${processUrl}/process`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'execute', command }),
      },
      PROCESS_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw new Error(
        `Failed to execute command in Daytona workspace: ${response.statusText}`,
      );
    }

    const result = (await response.json()) as {
      success: boolean;
      logs?: string[];
      message?: string;
    };

    return {
      exitCode: result.success ? 0 : 1,
      stdout: result.logs?.join('\n') || result.message || '',
      stderr: result.success ? '' : result.message || 'Execution failed',
    };
  }

  async getLogs(containerId: string): Promise<string[]> {
    this.validateContainerId(containerId);

    const workspaceId = this.getWorkspaceId(containerId);
    const response = await this.doRequest<DaytonaLogsResponse>(
      'GET',
      `/workspaces/${workspaceId}/logs`,
      undefined,
      EXECUTE_TIMEOUT_MS,
    );

    return response.logs ?? [];
  }

  async terminate(containerId: string): Promise<void> {
    this.validateContainerId(containerId);

    const workspaceId = this.getWorkspaceId(containerId);
    await this.doRequest<void>(
      'DELETE',
      `/workspaces/${workspaceId}`,
      undefined,
      PROVISION_TIMEOUT_MS,
    );
  }

  async getStatus(
    containerId: string,
  ): Promise<'running' | 'stopped' | 'error'> {
    this.validateContainerId(containerId);

    try {
      const workspace = await this.getWorkspace(containerId, EXECUTE_TIMEOUT_MS);
      return this.mapStatus(workspace.status);
    } catch (error) {
      return 'error';
    }
  }

  private validateSpawnParams(params: {
    configId: string;
    installationId: string;
    userId: string;
    containerImage: string;
    environmentVariables: Record<string, string>;
    resourceLimits: {
      cpuMillis: number;
      memoryMb: number;
      timeoutSeconds: number;
    };
  }): void {
    const required = [
      'configId',
      'installationId',
      'userId',
      'containerImage',
    ] as const;

    for (const key of required) {
      if (!(params as Record<string, unknown>)[key]) {
        throw new ValidationError(`${key} is required`);
      }
    }

    const { cpuMillis, memoryMb, timeoutSeconds } = params.resourceLimits ?? {};

    if (!cpuMillis || !memoryMb || !timeoutSeconds) {
      throw new ValidationError(
        'resourceLimits must include cpuMillis, memoryMb, timeoutSeconds',
      );
    }
  }

  private async findExistingWorkspace(
    configId: string,
  ): Promise<DaytonaWorkspaceDto | null> {
    const response = await this.doRequest<DaytonaWorkspacesResponse>(
      'GET',
      '/workspaces',
      undefined,
      PROVISION_TIMEOUT_MS,
      { configId },
    );

    const workspaces = response.workspaces ?? [];
    return workspaces.find((ws) => this.isWorkspaceHealthy(ws)) ?? null;
  }

  private isWorkspaceHealthy(workspace: DaytonaWorkspaceDto): boolean {
    return workspace.status === 'running' || workspace.status === 'ready';
  }

  private async getWorkspace(
    containerId: string,
    timeoutMs: number,
  ): Promise<DaytonaWorkspaceDto> {
    const workspaceId = this.getWorkspaceId(containerId);
    return this.doRequest<DaytonaWorkspaceDto>(
      'GET',
      `/workspaces/${workspaceId}`,
      undefined,
      timeoutMs,
    );
  }

  private getProcessUrl(workspace: DaytonaWorkspaceDto): string | undefined {
    return workspace.ports?.['8080'] ?? workspace.publicUrl;
  }

  private getWorkspaceId(containerId: string): string {
    if (!containerId.startsWith('daytona_')) {
      throw new ValidationError('Invalid Daytona containerId format');
    }

    return containerId.replace('daytona_', '');
  }

  private toContainerId(workspaceId: string): string {
    return `daytona_${workspaceId}`;
  }

  private validateContainerId(containerId: string): void {
    if (!containerId) {
      throw new ValidationError('containerId is required');
    }

    if (!containerId.startsWith('daytona_')) {
      throw new ValidationError('Invalid Daytona containerId');
    }
  }

  private mapStatus(status: string): 'running' | 'stopped' | 'error' {
    if (status === 'running' || status === 'ready') {
      return 'running';
    }

    if (status === 'terminated') {
      return 'stopped';
    }

    return 'error';
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async doRequest<T>(
    method: string,
    path: string,
    body: unknown,
    timeoutMs: number,
    query?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${this.apiUrl}${path}`);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Daytona API ${method} ${url.pathname} failed: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      if (response.status === 204) {
        return undefined as unknown as T;
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}
