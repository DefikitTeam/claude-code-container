import { IDeploymentRepository } from '../../interfaces/repositories/deployment.repository';
import { IDeploymentService } from '../../interfaces/services/deployment.service';
import { DeploymentEntity } from '../../entities/deployment.entity';
import { ValidationError } from '../../../shared/errors/validation.error';

export interface DeployWorkerDto {
  version: string;
  configHash: string;
  installationId: string;
  workerCode: string;
}

export interface DeployWorkerResult {
  deploymentId: string;
  version: string;
  status: string;
  url?: string;
}

/**
 * Deploy Worker Use Case
 * Deploys worker code to production
 */
export class DeployWorkerUseCase {
  constructor(
    private readonly deploymentRepository: IDeploymentRepository,
    private readonly deploymentService: IDeploymentService
  ) {}

  async execute(dto: DeployWorkerDto): Promise<DeployWorkerResult> {
    if (!dto.version || !dto.configHash || !dto.installationId || !dto.workerCode) {
      throw new ValidationError('version, configHash, installationId, and workerCode are required');
    }

    // Validate worker code
    const validation = await this.deploymentService.validate(dto.workerCode);
    if (!validation.valid) {
      throw new ValidationError(`Invalid worker code: ${validation.errors?.join(', ')}`);
    }

    // Create deployment entity
    const deploymentId = `deploy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const deployment = DeploymentEntity.create(deploymentId, dto.installationId, dto.version, dto.configHash);

    // Save deployment
    await this.deploymentRepository.save(deployment);

    // Deploy
    const result = await this.deploymentService.deploy(dto);

    // Mark as success
    const successDeployment = deployment.markSuccess();
    await this.deploymentRepository.save(successDeployment);

    return {
      deploymentId: successDeployment.deploymentId,
      version: successDeployment.version,
      status: 'success',
      url: result.url,
    };
  }
}
