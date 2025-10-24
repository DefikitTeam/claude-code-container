/**
 * E2E Test: Deployment Flow
 * Tests the complete deployment use case with mocked dependencies
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeployWorkerUseCase } from '../core/use-cases/deployment/deploy-worker.use-case';
import { GetStatusUseCase } from '../core/use-cases/deployment/get-status.use-case';
import { ValidationError } from '../shared/errors/validation.error';
import { NotFoundError } from '../shared/errors/not-found.error';

describe('E2E: Deployment Flow', () => {
  let deployUseCase: DeployWorkerUseCase;
  let getStatusUseCase: GetStatusUseCase;
  let mockDeploymentRepository: any;
  let mockDeploymentService: any;

  beforeEach(() => {
    mockDeploymentRepository = {
      save: vi.fn().mockResolvedValue(undefined),
      findById: vi.fn().mockResolvedValue({
        deploymentId: 'deploy_123',
        installationId: 'inst456',
        version: '1.0.0',
        status: 'success',
        configHash: 'hash123',
        created: Date.now(),
        updated: Date.now(),
        deployedAt: Date.now(),
      }),
      findLatestByInstallation: vi.fn().mockResolvedValue(null),
      listByInstallation: vi.fn().mockResolvedValue([]),
    };

    mockDeploymentService = {
      deploy: vi.fn().mockResolvedValue({ success: true, url: 'https://example.com' }),
      getStatus: vi.fn().mockResolvedValue({ status: 'success', message: 'OK' }),
      rollback: vi.fn().mockResolvedValue({ success: true }),
      validate: vi.fn().mockResolvedValue({ valid: true }),
    };

    deployUseCase = new DeployWorkerUseCase(mockDeploymentRepository, mockDeploymentService);
    getStatusUseCase = new GetStatusUseCase(mockDeploymentRepository);
  });

  it('should successfully deploy worker code', async () => {
    const result = await deployUseCase.execute({
      version: '1.0.0',
      configHash: 'hash123',
      installationId: 'inst456',
      workerCode: 'export default { fetch() {} }',
    });

    expect(result.status).toBe('success');
    expect(result.version).toBe('1.0.0');
    expect(result.url).toBe('https://example.com');
    expect(mockDeploymentService.validate).toHaveBeenCalled();
    expect(mockDeploymentService.deploy).toHaveBeenCalled();
  });

  it('should retrieve deployment status', async () => {
    const result = await getStatusUseCase.execute({
      deploymentId: 'deploy_123',
    });

    expect(result.deploymentId).toBe('deploy_123');
    expect(result.status).toBe('success');
    expect(result.version).toBe('1.0.0');
  });

  it('should throw ValidationError when code validation fails', async () => {
    mockDeploymentService.validate.mockResolvedValue({ valid: false, errors: ['Syntax error'] });

    await expect(
      deployUseCase.execute({
        version: '1.0.0',
        configHash: 'hash123',
        installationId: 'inst456',
        workerCode: 'invalid',
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should throw NotFoundError when deployment not found', async () => {
    mockDeploymentRepository.findById.mockResolvedValue(null);

    await expect(
      getStatusUseCase.execute({
        deploymentId: 'nonexistent',
      })
    ).rejects.toThrow(NotFoundError);
  });
});
