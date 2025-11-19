/**
 * Container Service Interface
 * Defines contract for container execution operations
 */

export interface IContainerService {
  /**
   * Spawn a new container with config
   */
  spawn(params: {
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
  }): Promise<{ containerId: string }>;

  /**
   * Execute command in container
   */
  execute(
    containerId: string,
    command: string,
  ): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;

  /**
   * Get container logs
   */
  getLogs(containerId: string): Promise<string[]>;

  /**
   * Terminate a container
   */
  terminate(containerId: string): Promise<void>;

  /**
   * Check container status
   */
  getStatus(containerId: string): Promise<'running' | 'stopped' | 'error'>;
}
