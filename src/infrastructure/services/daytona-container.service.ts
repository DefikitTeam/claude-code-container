import { IContainerService } from '../../core/interfaces/services/container.service';
import { ValidationError } from '../../shared/errors/validation.error';

const PROVISION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for create/delete
const EXECUTE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes for execute/status
const PROCESS_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes for forwarding commands
const WORKSPACE_READY_POLL_INTERVAL_MS = 2000; // 2 seconds between status checks
const WORKSPACE_READY_MAX_ATTEMPTS = 60; // Max 2 minutes waiting for ready state

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
    private readonly organizationId?: string,
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
    // Note: Daytona API does not currently support applying resource limits such as CPU, memory,
    // or execution timeout to workspaces. We still call `validateSpawnParams` so that
    // `resourceLimits` are validated consistently with other providers, but these limits are
    // not actually sent in the `/sandbox` payload. If Daytona adds support for resource limits
    // in the future, the payload construction below should be updated to include them.
    this.validateSpawnParams(params);

    const existingWorkspace = await this.findExistingWorkspace(params.configId);

    if (existingWorkspace && this.isWorkspaceHealthy(existingWorkspace)) {
      return { containerId: this.toContainerId(existingWorkspace.id) };
    }

    const payload = {
      // Daytona API uses 'image' field for Docker/OCI images (auto-creates snapshot internally)
      image: params.containerImage,
      // Environment variables
      envVars: params.environmentVariables,
      // Labels for identification
      labels: {
        configId: params.configId,
        installationId: params.installationId,
        userId: params.userId,
      },
    };

    const workspace = await this.doRequest<DaytonaWorkspaceDto>(
      'POST',
      '/sandbox',
      payload,
      PROVISION_TIMEOUT_MS,
    );

    // Poll until workspace is ready (running/ready/started)
    const readyWorkspace = await this.waitForWorkspaceReady(workspace.id);
    return { containerId: this.toContainerId(readyWorkspace.id) };
  }

  async execute(
    containerId: string,
    command: string,
    endpoint?: string,
  ): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    if (!containerId || !command) {
      throw new ValidationError('containerId and command are required');
    }

    // If endpoint is provided, forward HTTP request to container's HTTP server
    // instead of running a shell command
    if (endpoint) {
      return this.executeHttpRequest(containerId, command, endpoint);
    }

    const workspaceId = this.getWorkspaceId(containerId);

    // Use Toolbox API with bash -c wrapper for proper shell interpretation
    // This ensures shell operators (&&, ||, |, ;) are parsed correctly
    const wrappedCommand = `bash -c ${JSON.stringify(command)}`;

    console.log(
      `[DAYTONA] Executing via Toolbox API: ${wrappedCommand.substring(0, 100)}...`,
    );

    const result = await this.executeViaToolbox(workspaceId, wrappedCommand);

    return {
      exitCode: result.exitCode,
      stdout: result.result || '',
      stderr: result.exitCode !== 0 ? result.result || 'Execution failed' : '',
    };
  }

  /**
   * Forward HTTP request to container's HTTP server endpoint
   * Used when an endpoint path is specified (e.g., '/process-prompt')
   */
  private async executeHttpRequest(
    containerId: string,
    jsonBody: string,
    endpoint: string,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const workspace = await this.getWorkspace(containerId, EXECUTE_TIMEOUT_MS);
    const processUrl = this.getProcessUrl(workspace);

    if (!processUrl) {
      throw new ValidationError(
        `Workspace ${workspace.id} does not have a public URL for HTTP requests`,
      );
    }

    const url = `${processUrl}${endpoint}`;
    console.log(`[DAYTONA] Forwarding HTTP request to: ${url}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROCESS_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonBody,
        signal: controller.signal,
      });

      const text = await response.text();
      console.log(
        `[DAYTONA] HTTP response: ${response.status}, body length: ${text.length}`,
      );

      return {
        exitCode: response.ok ? 0 : 1,
        stdout: text,
        stderr: response.ok ? '' : text,
      };
    } catch (error) {
      console.error(`[DAYTONA] HTTP request failed:`, error);
      return {
        exitCode: 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : 'HTTP request failed',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Execute command via Daytona Toolbox API
   * This is the recommended way to run commands in Daytona sandboxes
   */
  private async executeViaToolbox(
    sandboxId: string,
    command: string,
    timeoutSeconds: number = 120,
  ): Promise<{ exitCode: number; result: string }> {
    // Sanitize API URL
    let apiUrl = this.apiUrl.split('#')[0];
    if (!apiUrl.endsWith('/')) {
      apiUrl += '/';
    }

    const url = `${apiUrl}toolbox/${sandboxId}/toolbox/process/execute`;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      (timeoutSeconds + 10) * 1000,
    );

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      };

      // Add Organization ID header for JWT authentication
      if (this.organizationId) {
        headers['X-Daytona-Organization-ID'] = this.organizationId;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          command,
          timeout: timeoutSeconds,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[DAYTONA] Toolbox execute failed: ${response.status} - ${errorText}`,
        );
        return {
          exitCode: 1,
          result: `Toolbox API error: ${response.status} ${response.statusText}`,
        };
      }

      const result = (await response.json()) as {
        exitCode: number;
        result: string;
      };
      console.log(
        `[DAYTONA] Toolbox execute result: exitCode=${result.exitCode}`,
      );

      return result;
    } catch (error) {
      console.error(`[DAYTONA] Toolbox execute error:`, error);
      return {
        exitCode: 1,
        result: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async getLogs(containerId: string): Promise<string[]> {
    this.validateContainerId(containerId);

    const workspaceId = this.getWorkspaceId(containerId);
    const response = await this.doRequest<DaytonaLogsResponse>(
      'GET',
      `/sandbox/${workspaceId}/logs`,
      undefined,
      EXECUTE_TIMEOUT_MS,
    );

    return response.logs ?? [];
  }

  async terminate(containerId: string): Promise<void> {
    this.validateContainerId(containerId);

    const workspaceId = this.getWorkspaceId(containerId);
    try {
      await this.doRequest<void>(
        'DELETE',
        `/sandbox/${workspaceId}`,
        undefined,
        PROVISION_TIMEOUT_MS,
      );
    } catch (error) {
      // Handle 404 gracefully for idempotent termination
      // If workspace doesn't exist, consider it already terminated
      if (error instanceof Error && error.message.includes('404')) {
        return;
      }
      throw error;
    }
  }

  async getStatus(
    containerId: string,
  ): Promise<'running' | 'stopped' | 'error'> {
    this.validateContainerId(containerId);

    try {
      const workspace = await this.getWorkspace(
        containerId,
        EXECUTE_TIMEOUT_MS,
      );
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
    // Daytona /sandbox returns array directly
    const response = await this.doRequest<DaytonaWorkspaceDto[]>(
      'GET',
      '/sandbox',
      undefined,
      PROVISION_TIMEOUT_MS,
    );

    const workspaces = response ?? [];
    // Filter by configId to prevent cross-config reuse in multi-tenant scenarios
    return (
      workspaces.find(
        (ws) => ws.configId === configId && this.isWorkspaceHealthy(ws),
      ) ?? null
    );
  }

  private async waitForWorkspaceReady(
    workspaceId: string,
  ): Promise<DaytonaWorkspaceDto> {
    for (let attempt = 0; attempt < WORKSPACE_READY_MAX_ATTEMPTS; attempt++) {
      const workspace = await this.doRequest<DaytonaWorkspaceDto>(
        'GET',
        `/sandbox/${workspaceId}`,
        undefined,
        EXECUTE_TIMEOUT_MS,
      );

      if (this.isWorkspaceHealthy(workspace)) {
        return workspace;
      }

      // Check for terminal failure states
      if (workspace.status === 'failed' || workspace.status === 'error') {
        throw new Error(
          `Daytona workspace ${workspaceId} failed to start: ${workspace.status}`,
        );
      }

      // Wait before next poll
      await this.sleep(WORKSPACE_READY_POLL_INTERVAL_MS);
    }

    throw new Error(
      `Daytona workspace ${workspaceId} did not become ready within timeout`,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isWorkspaceHealthy(workspace: DaytonaWorkspaceDto): boolean {
    return (
      workspace.status === 'running' ||
      workspace.status === 'ready' ||
      workspace.status === 'started'
    );
  }

  private async getWorkspace(
    containerId: string,
    timeoutMs: number,
  ): Promise<DaytonaWorkspaceDto> {
    const workspaceId = this.getWorkspaceId(containerId);
    return this.doRequest<DaytonaWorkspaceDto>(
      'GET',
      `/sandbox/${workspaceId}`,
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
    if (status === 'running' || status === 'ready' || status === 'started') {
      return 'running';
    }

    if (status === 'terminated' || status === 'stopped') {
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
    // Sanitize API URL
    let apiUrl = this.apiUrl.split('#')[0];
    if (!apiUrl.endsWith('/')) {
      apiUrl += '/';
    }

    // Ensure path is relative (no leading slash)
    const relativePath = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(relativePath, apiUrl);

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
