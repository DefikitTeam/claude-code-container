import { IDeploymentRepository } from '../../interfaces/repositories/deployment.repository';
import { IDeploymentService } from '../../interfaces/services/deployment.service';
import { ValidationError } from '../../../shared/errors/validation.error';
import { NotFoundError } from '../../../shared/errors/not-found.error';

export interface RollbackDto {
  deploymentId: string;
  previousVersion: string;
}

export interface RollbackResult {
  deploymentId: string;
  status: string;
  message: string;
}

/**
 * Rollback Use Case
 * Reverts to a previous deployment version
 */
export class RollbackUseCase {
  constructor(
    private readonly deploymentRepository: IDeploymentRepository,
    private readonly deploymentService: IDeploymentService,
  ) {}

  async execute(dto: RollbackDto): Promise<RollbackResult> {
    if (!dto.deploymentId || !dto.previousVersion) {
      throw new ValidationError(
        'deploymentId and previousVersion are required',
      );
    }

    const deployment = await this.deploymentRepository.findById(
      dto.deploymentId,
    );
    if (!deployment) {
      throw new NotFoundError(`Deployment ${dto.deploymentId} not found`);
    }

    // Perform rollback
    const result = await this.deploymentService.rollback(
      dto.deploymentId,
      dto.previousVersion,
    );

    if (!result.success) {
      throw new Error('Rollback failed');
    }

    // Mark as rolled back
    const rolledBack = deployment.markRolledBack();
    await this.deploymentRepository.save(rolledBack);

    return {
      deploymentId: rolledBack.deploymentId,
      status: 'rolled-back',
      message: 'Deployment rolled back successfully',
    };
  }
}
