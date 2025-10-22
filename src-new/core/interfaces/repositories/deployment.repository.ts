/**
 * Deployment Repository Interface
 * Defines contract for deployment persistence
 */

import { DeploymentEntity } from '../../entities/deployment.entity';

export interface IDeploymentRepository {
  /**
   * Save or update a deployment
   */
  save(deployment: DeploymentEntity): Promise<void>;

  /**
   * Find a deployment by ID
   */
  findById(deploymentId: string): Promise<DeploymentEntity | null>;

  /**
   * Find latest deployment for an installation
   */
  findLatestByInstallation(installationId: string): Promise<DeploymentEntity | null>;

  /**
   * List deployments for an installation
   */
  listByInstallation(installationId: string, limit?: number): Promise<DeploymentEntity[]>;
}
