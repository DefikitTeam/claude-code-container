/**
 * Cloudflare-backed implementation of {@link IContainerService}.
 *
 * Operates Durable Object containers through ContainerDO (extends
 * `@cloudflare/containers`). The underlying Container runs the HTTP server in
 * `container_src` and exposes `/health`, `/process`, and `/acp` for health,
 * command execution, and ACP requests respectively.
 */

import { IContainerService } from '../../core/interfaces/services/container.service';
import { ValidationError } from '../../shared/errors/validation.error';

/**
 * Adapter that fulfills the container service contract using Cloudflare
 * containers.
 */
export class CloudflareContainerService implements IContainerService {
  constructor(private readonly namespace: DurableObjectNamespace<any>) {}

  /**
   * Spawn a new container with the given configuration
   *
   * For real Cloudflare Containers:
   * 1. Get the ContainerDO stub with a unique ID
   * 2. Make a request to the container to wake it up and initialize
   * 3. The container HTTP server will handle the request at /health or /acp/initialize
   */
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

    const containerId = this.generateContainerId(params.configId);

    // For real containers, we just need to check if they're alive
    // The container HTTP server expects GET /health to wake up and validate
    try {
      const response = await this.doRequest(
        'GET',
        '/health',
        undefined,
        containerId,
      );

      if (!response.ok) {
        throw new Error(
          `Container health check failed: ${response.statusText}`,
        );
      }

      // Container is alive and healthy
      return { containerId };
    } catch (error) {
      throw new Error(
        `Failed to spawn container: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Execute a command/prompt in a container
   *
   * This uses the specified endpoint for processing (default: /process)
   * or /acp for ACP protocol interactions
   */
  async execute(
    containerId: string,
    command: string,
    endpoint: string = '/process',
  ): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    if (!containerId || !command) {
      throw new ValidationError('containerId and command are required');
    }

    // Parse command as JSON if it looks like JSON, otherwise wrap as command
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(command);
    } catch {
      body = {
        type: 'execute',
        command,
      };
    }

    const response = await this.doRequest('POST', endpoint, body, containerId);
    if (!response.ok) {
      throw new Error(`Failed to execute command: ${response.statusText}`);
    }

    const result = (await response.json()) as {
      success: boolean;
      logs?: string[];
      message?: string;
      [key: string]: unknown;
    };

    // For endpoints that return full JSON response (like /process-prompt),
    // include the entire response as stdout
    const stdout =
      endpoint === '/process'
        ? result.logs?.join('\n') || result.message || ''
        : JSON.stringify(result);

    // Map container response to expected format
    // For ACP (JSON-RPC), success is implied by valid response structure, not strict 'success' boolean
    // JSON-RPC success response: { jsonrpc: '2.0', result: ... }
    // JSON-RPC error response: { jsonrpc: '2.0', error: ... }
    const isJsonRpc = (result as any).jsonrpc === '2.0';
    const isAcpEndpoint = endpoint.includes('/acp');

    // For ACP/JSON-RPC, we consider it "successful command execution" if we got a valid response (exitCode 0)
    // The caller is responsible for checking rpcResponse.error
    const isSuccess = isJsonRpc || isAcpEndpoint ? true : !!result.success;

    return {
      exitCode: isSuccess ? 0 : 1,
      stdout,
      stderr: isSuccess ? '' : result.message || 'Command failed',
    };
  }

  /**
   * Retrieve container logs
   *
   * For real containers, logs are retrieved from the container's runtime
   * We use the /health endpoint response which includes diagnostic info
   */
  async getLogs(containerId: string): Promise<string[]> {
    if (!containerId) {
      throw new ValidationError('containerId is required');
    }

    const response = await this.doRequest(
      'GET',
      '/health',
      undefined,
      containerId,
    );

    if (!response.ok) {
      throw new Error(`Failed to retrieve logs: ${response.statusText}`);
    }

    const health = (await response.json()) as {
      status: string;
      message: string;
      timestamp: string;
    };

    // Return basic health info as logs
    return [
      `Status: ${health.status}`,
      `Message: ${health.message}`,
      `Timestamp: ${health.timestamp}`,
    ];
  }

  /**
   * Terminate a container
   *
   * For real Cloudflare Containers, termination happens automatically
   * after the sleepAfter timeout (5 minutes by default in ContainerDO)
   * We don't have explicit termination, so this is a no-op
   */
  async terminate(containerId: string): Promise<void> {
    if (!containerId) {
      throw new ValidationError('containerId is required');
    }

    // Real containers auto-terminate after sleepAfter timeout
    // This is a no-op for compliance with the interface
    console.log(
      `Container ${containerId} will auto-terminate after inactivity`,
    );
  }

  /**
   * Check container status
   *
   * Checks if the container is responsive by hitting the /health endpoint
   */
  async getStatus(
    containerId: string,
  ): Promise<'running' | 'stopped' | 'error'> {
    if (!containerId) {
      throw new ValidationError('containerId is required');
    }

    try {
      const response = await this.doRequest(
        'GET',
        '/health',
        undefined,
        containerId,
      );

      if (!response.ok) {
        return 'error';
      }

      const health = (await response.json()) as { status: string };

      // Map health status to container status
      if (health.status === 'healthy' || health.status === 'degraded') {
        return 'running';
      }

      return 'error';
    } catch (error) {
      // Container is not responsive
      return 'stopped';
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

  private generateContainerId(configId: string): string {
    const suffix = Math.random().toString(36).slice(2, 10);
    return `ctr_${configId}_${suffix}`;
  }

  /**
   * Make a request to the container's HTTP server
   *
   * The container runs an HTTP server (container_src) that handles:
   * - GET /health - Health check
   * - POST /process - Generic processing
   * - POST /acp - ACP JSON-RPC endpoint
   */
  private async doRequest(
    method: string,
    path: string,
    body: unknown,
    containerId: string,
    query?: Record<string, string>,
  ): Promise<Response> {
    const id = this.namespace.idFromName(containerId);
    const stub = (this.namespace as any).get(id);

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
