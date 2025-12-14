/**
 * E2E Test: Cross-module workflow covering GitHub, Container, and Deployment flows
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegisterUserUseCase } from '../core/use-cases/user/register-user.use-case';
import { FetchRepositoriesUseCase } from '../core/use-cases/github/fetch-repositories.use-case';
import { CreatePullRequestUseCase } from '../core/use-cases/github/create-pull-request.use-case';
import { SpawnContainerUseCase } from '../core/use-cases/container/spawn-container.use-case';
import { ProcessPromptUseCase } from '../core/use-cases/container/process-prompt.use-case';
import { DeployWorkerUseCase } from '../core/use-cases/deployment/deploy-worker.use-case';
import { GetStatusUseCase } from '../core/use-cases/deployment/get-status.use-case';
import { RollbackUseCase } from '../core/use-cases/deployment/rollback.use-case';
import { ValidateConfigUseCase } from '../core/use-cases/deployment/validate-config.use-case';
import { DeploymentEntity } from '../core/entities/deployment.entity';

describe('E2E: Full Platform Workflow', () => {
  const mockUserRepository: any = {};
  const mockGitHubService: any = {};
  const mockCryptoService: any = {};
  const mockContainerService: any = {};
  const mockDeploymentRepository: any = {};
  const mockDeploymentService: any = {};

  beforeEach(() => {
    mockUserRepository.save = vi.fn().mockResolvedValue(undefined);
    mockUserRepository.findById = vi.fn().mockResolvedValue(null);

    mockGitHubService.validateInstallation = vi.fn().mockResolvedValue(true);
    mockGitHubService.fetchRepositories = vi.fn().mockResolvedValue([
      {
        id: 1,
        name: 'infra',
        fullName: 'org/infra',
        url: 'https://github.com/org/infra',
      },
      {
        id: 2,
        name: 'app',
        fullName: 'org/app',
        url: 'https://github.com/org/app',
      },
    ]);
    mockGitHubService.createPullRequest = vi.fn().mockResolvedValue({
      number: 42,
      url: 'https://github.com/org/app/pull/42',
      title: 'feat: automate release',
    });

    mockCryptoService.encrypt = vi.fn().mockResolvedValue({
      encryptedData: new Uint8Array([1, 2, 3]),
      iv: new Uint8Array([4, 5, 6]),
    });

    mockContainerService.spawn = vi
      .fn()
      .mockResolvedValue({ containerId: 'ctr_abc123' });
    mockContainerService.execute = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'Execution successful',
      stderr: '',
    });
    mockContainerService.getLogs = vi
      .fn()
      .mockResolvedValue(['[2023-01-01T00:00:00Z] Command executed: npm test']);
    mockContainerService.terminate = vi.fn().mockResolvedValue(undefined);
    mockContainerService.getStatus = vi.fn().mockResolvedValue('running');

    const deployments = new Map<string, DeploymentEntity>();
    mockDeploymentRepository.save = vi.fn(
      async (deployment: DeploymentEntity) => {
        deployments.set(deployment.deploymentId, deployment);
      },
    );
    mockDeploymentRepository.findById = vi.fn(
      async (id: string) => deployments.get(id) ?? null,
    );
    mockDeploymentRepository.findLatestByInstallation = vi.fn(async () => null);
    mockDeploymentRepository.listByInstallation = vi.fn(async () =>
      Array.from(deployments.values()),
    );

    mockDeploymentService.deploy = vi
      .fn()
      .mockResolvedValue({
        success: true,
        url: 'https://workers.dev/deploy/1',
      });
    mockDeploymentService.getStatus = vi
      .fn()
      .mockResolvedValue({ status: 'success' });
    mockDeploymentService.rollback = vi
      .fn()
      .mockResolvedValue({ success: true });
    mockDeploymentService.validate = vi.fn().mockResolvedValue({ valid: true });
  });

  it('should register user, create PR, execute container task, and deploy worker', async () => {
    const registerUser = new RegisterUserUseCase(
      mockUserRepository,
      mockGitHubService,
      mockCryptoService,
    );
    const fetchRepositories = new FetchRepositoriesUseCase(mockGitHubService);
    const createPullRequest = new CreatePullRequestUseCase(mockGitHubService);
    const spawnContainer = new SpawnContainerUseCase(mockContainerService);
    const processPrompt = new ProcessPromptUseCase(mockContainerService);
    const deployWorker = new DeployWorkerUseCase(
      mockDeploymentRepository,
      mockDeploymentService,
    );
    const getStatus = new GetStatusUseCase(mockDeploymentRepository);
    const rollback = new RollbackUseCase(
      mockDeploymentRepository,
      mockDeploymentService,
    );
    const validateConfig = new ValidateConfigUseCase(mockDeploymentService);

    const registration = await registerUser.execute({
      userId: 'user-1',
      installationId: 'inst-1',
      anthropicApiKey: 'sk-ant-123',
    });

    expect(registration.userId).toBe('user-1');
    expect(mockUserRepository.save).toHaveBeenCalled();

    const repositories = await fetchRepositories.execute({
      installationId: 'inst-1',
    });
    expect(repositories.repositories).toHaveLength(2);

    const pr = await createPullRequest.execute({
      owner: 'org',
      repo: 'app',
      title: 'feat: automate release',
      body: 'Automated changes generated by workflow.',
      head: 'feature/automation',
      base: 'main',
      installationId: 'inst-1',
    });

    expect(pr.url).toContain('/pull/42');

    const container = await spawnContainer.execute({
      configId: 'cfg-1',
      installationId: 'inst-1',
      userId: 'user-1',
      containerImage: 'node:18',
      environmentVariables: { NODE_ENV: 'test' },
      resourceLimits: { cpuMillis: 500, memoryMb: 512, timeoutSeconds: 120 },
    });

    expect(container.containerId).toBe('ctr_abc123');

    const commandResult = await processPrompt.execute({
      containerId: container.containerId,
      prompt: 'npm test',
    });
    expect(commandResult.success).toBe(true);

    const validation = await validateConfig.execute({
      workerCode: 'export default {}',
    });
    expect(validation.valid).toBe(true);

    const deployment = await deployWorker.execute({
      version: '1.0.0',
      configHash: 'hash-123',
      installationId: 'inst-1',
      workerCode: 'export default {}',
    });

    expect(deployment.url).toContain('https://workers.dev/deploy/1');

    const status = await getStatus.execute({
      deploymentId: deployment.deploymentId,
    });
    expect(status.status).toBe('success');

    const rollbackResult = await rollback.execute({
      deploymentId: deployment.deploymentId,
      previousVersion: '0.9.0',
    });
    expect(rollbackResult.status).toBe('rolled-back');
  });
});
