import { Context } from 'hono';
import { DeployWorkerUseCase } from '../../core/use-cases/deployment/deploy-worker.use-case';
import { GetStatusUseCase } from '../../core/use-cases/deployment/get-status.use-case';
import { RollbackUseCase } from '../../core/use-cases/deployment/rollback.use-case';
import { ValidateConfigUseCase } from '../../core/use-cases/deployment/validate-config.use-case';
import { parseDeployWorkerDTO } from '../dto/deploy-worker.dto';
import {
  successResponse,
  createdResponse,
} from '../responses/success.response';
import { errorResponse } from '../responses/error.response';

export class DeploymentController {
  constructor(
    private deployWorkerUseCase: DeployWorkerUseCase,
    private getStatusUseCase: GetStatusUseCase,
    private rollbackUseCase: RollbackUseCase,
    private validateConfigUseCase: ValidateConfigUseCase,
  ) {}

  async deployWorker(c: Context) {
    try {
      const installationId = c.req.header('x-installation-id')!;
      const body = await c.req.json();
      const deploymentData = parseDeployWorkerDTO(body, installationId);

      const result = await this.deployWorkerUseCase.execute(deploymentData);

      return createdResponse(c, result);
    } catch (err: unknown) {
      return errorResponse(c, err);
    }
  }

  async getStatus(c: Context) {
    try {
      const deploymentId = c.req.param('deploymentId');

      if (!deploymentId) {
        return errorResponse(c, new Error('Deployment ID is required'));
      }

      const result = await this.getStatusUseCase.execute({ deploymentId });

      return successResponse(c, result, 200);
    } catch (err: unknown) {
      return errorResponse(c, err);
    }
  }

  async rollback(c: Context) {
    try {
      const deploymentId = c.req.param('deploymentId');
      const body = await c.req.json();

      if (!deploymentId) {
        return errorResponse(c, new Error('Deployment ID is required'));
      }

      const previousVersion = body.previousVersion || 'latest';

      const result = await this.rollbackUseCase.execute({
        deploymentId,
        previousVersion,
      });

      return successResponse(c, result, 200);
    } catch (err: unknown) {
      return errorResponse(c, err);
    }
  }

  async validateConfig(c: Context) {
    try {
      const body = await c.req.json();

      const result = await this.validateConfigUseCase.execute({
        workerCode: body.script || body.workerCode,
      });

      return successResponse(c, result, 200);
    } catch (err: unknown) {
      return errorResponse(c, err);
    }
  }
}
