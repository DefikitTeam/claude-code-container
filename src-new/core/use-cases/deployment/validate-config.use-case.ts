import { IDeploymentService } from '../../interfaces/services/deployment.service';
import { ValidationError } from '../../../shared/errors/validation.error';

export interface ValidateConfigDto {
  workerCode: string;
}

export interface ValidateConfigResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Validate Config Use Case
 * Validates worker code before deployment
 */
export class ValidateConfigUseCase {
  constructor(private readonly deploymentService: IDeploymentService) {}

  async execute(dto: ValidateConfigDto): Promise<ValidateConfigResult> {
    if (!dto.workerCode) {
      throw new ValidationError('workerCode is required');
    }

    const result = await this.deploymentService.validate(dto.workerCode);

    return {
      valid: result.valid,
      errors: result.errors,
    };
  }
}
