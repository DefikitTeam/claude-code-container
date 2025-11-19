import { IDeploymentRepository } from '../../interfaces/repositories/deployment.repository';
import { ValidationError } from '../../../shared/errors/validation.error';
import { NotFoundError } from '../../../shared/errors/not-found.error';

export interface GetStatusDto {
  deploymentId: string;
}

export interface GetStatusResult {
  deploymentId: string;
  status: string;
  version: string;
  deployedAt?: number;
  failureReason?: string;
}

/**
 * Get Status Use Case
 * Retrieves deployment status
 */
export class GetStatusUseCase {
  constructor(private readonly deploymentRepository: IDeploymentRepository) {}

  async execute(dto: GetStatusDto): Promise<GetStatusResult> {
    if (!dto.deploymentId) {
      throw new ValidationError('deploymentId is required');
    }

    const deployment = await this.deploymentRepository.findById(
      dto.deploymentId,
    );
    if (!deployment) {
      throw new NotFoundError(`Deployment ${dto.deploymentId} not found`);
    }

    return {
      deploymentId: deployment.deploymentId,
      status: deployment.status,
      version: deployment.version,
      deployedAt: deployment.deployedAt,
      failureReason: deployment.failureReason,
    };
  }
}
