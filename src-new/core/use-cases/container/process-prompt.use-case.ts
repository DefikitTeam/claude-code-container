import { IContainerService } from '../../interfaces/services/container.service';
import { ValidationError } from '../../../shared/errors/validation.error';

export interface ProcessPromptDto {
  containerId: string;
  prompt: string;
}

export interface ProcessPromptResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  success: boolean;
}

/**
 * Process Prompt Use Case
 * Executes a prompt/command in a container
 */
export class ProcessPromptUseCase {
  constructor(private readonly containerService: IContainerService) {}

  async execute(dto: ProcessPromptDto): Promise<ProcessPromptResult> {
    if (!dto.containerId || !dto.prompt) {
      throw new ValidationError('containerId and prompt are required');
    }

    const result = await this.containerService.execute(dto.containerId, dto.prompt);

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      success: result.exitCode === 0,
    };
  }
}
