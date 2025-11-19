/**
 * E2E Test: Container Execution Flow
 * Tests the complete container execution use case with mocked dependencies
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpawnContainerUseCase } from '../core/use-cases/container/spawn-container.use-case';
import { ProcessPromptUseCase } from '../core/use-cases/container/process-prompt.use-case';
import { TerminateContainerUseCase } from '../core/use-cases/container/terminate-container.use-case';
import { ValidationError } from '../shared/errors/validation.error';

describe('E2E: Container Execution Flow', () => {
  let spawnUseCase: SpawnContainerUseCase;
  let processUseCase: ProcessPromptUseCase;
  let terminateUseCase: TerminateContainerUseCase;
  let mockContainerService: any;

  beforeEach(() => {
    mockContainerService = {
      spawn: vi.fn().mockResolvedValue({ containerId: 'container_123' }),
      execute: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: 'Success',
        stderr: '',
      }),
      getLogs: vi.fn().mockResolvedValue(['log1', 'log2']),
      terminate: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockResolvedValue('running'),
    };

    spawnUseCase = new SpawnContainerUseCase(mockContainerService);
    processUseCase = new ProcessPromptUseCase(mockContainerService);
    terminateUseCase = new TerminateContainerUseCase(mockContainerService);
  });

  it('should spawn a container successfully', async () => {
    const result = await spawnUseCase.execute({
      configId: 'config_123',
      installationId: 'inst456',
      userId: 'user789',
      containerImage: 'node:18',
      environmentVariables: { NODE_ENV: 'production' },
      resourceLimits: { cpuMillis: 1000, memoryMb: 512, timeoutSeconds: 300 },
    });

    expect(result.containerId).toBe('container_123');
    expect(result.status).toBe('running');
    expect(mockContainerService.spawn).toHaveBeenCalled();
  });

  it('should execute prompt in container', async () => {
    const result = await processUseCase.execute({
      containerId: 'container_123',
      prompt: 'echo "Hello"',
    });

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('Success');
    expect(mockContainerService.execute).toHaveBeenCalledWith(
      'container_123',
      'echo "Hello"',
    );
  });

  it('should terminate container', async () => {
    const result = await terminateUseCase.execute({
      containerId: 'container_123',
    });

    expect(result.status).toBe('terminated');
    expect(result.message).toBe('Container terminated successfully');
    expect(mockContainerService.terminate).toHaveBeenCalledWith(
      'container_123',
    );
  });

  it('should throw ValidationError when required fields missing', async () => {
    await expect(
      spawnUseCase.execute({
        configId: '',
        installationId: 'inst456',
        userId: 'user789',
        containerImage: 'node:18',
        environmentVariables: {},
        resourceLimits: { cpuMillis: 1000, memoryMb: 512, timeoutSeconds: 300 },
      }),
    ).rejects.toThrow(ValidationError);
  });

  it('should capture process failure', async () => {
    mockContainerService.execute.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'Error occurred',
    });

    const result = await processUseCase.execute({
      containerId: 'container_123',
      prompt: 'false',
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('Error occurred');
  });
});
