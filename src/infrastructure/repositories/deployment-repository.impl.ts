/**
 * Deployment Repository Implementation
 * Persistent storage for deployment history and status tracking
 *
 * Implements: IDeploymentRepository
 */

import { DeploymentEntity } from '../../core/entities/deployment.entity';
import { IDeploymentRepository } from '../../core/interfaces/repositories/deployment.repository';
import { ValidationError } from '../../shared/errors/validation.error';

/**
 * In-memory deployment storage (for development)
 * In production, this would be backed by Durable Object or KV storage
 */
interface DeploymentStorage {
  deployments: Map<string, DeploymentEntity>;
  installationIndex: Map<string, string[]>; // installationId -> [deploymentIds...]
}

/**
 * Deployment Repository Implementation
 */
export class DeploymentRepositoryImpl implements IDeploymentRepository {
  private storage: DeploymentStorage = {
    deployments: new Map(),
    installationIndex: new Map(),
  };

  /**
   * Save or update a deployment
   *
   * @param deployment - DeploymentEntity to save
   * @throws ValidationError if deployment is invalid
   */
  async save(deployment: DeploymentEntity): Promise<void> {
    if (!deployment || !deployment.deploymentId || !deployment.installationId) {
      throw new ValidationError('Invalid deployment entity');
    }

    try {
      const deploymentId = deployment.deploymentId;
      const installationId = deployment.installationId;

      // Save deployment
      this.storage.deployments.set(deploymentId, deployment);

      // Update installation index
      const currentIndex =
        this.storage.installationIndex.get(installationId) || [];
      if (!currentIndex.includes(deploymentId)) {
        currentIndex.push(deploymentId);
        this.storage.installationIndex.set(installationId, currentIndex);
      }
    } catch (error) {
      throw new Error(
        `Failed to save deployment ${deployment.deploymentId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Find a deployment by ID
   *
   * @param deploymentId - Deployment ID to find
   * @returns DeploymentEntity or null if not found
   * @throws ValidationError if deploymentId is invalid
   */
  async findById(deploymentId: string): Promise<DeploymentEntity | null> {
    if (!deploymentId || typeof deploymentId !== 'string') {
      throw new ValidationError('deploymentId must be a non-empty string');
    }

    try {
      const deployment = this.storage.deployments.get(deploymentId);
      return deployment || null;
    } catch (error) {
      throw new Error(
        `Failed to find deployment ${deploymentId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Find latest deployment for an installation
   *
   * @param installationId - Installation ID
   * @returns Latest DeploymentEntity or null if no deployments
   */
  async findLatestByInstallation(
    installationId: string,
  ): Promise<DeploymentEntity | null> {
    if (!installationId || typeof installationId !== 'string') {
      throw new ValidationError('installationId must be a non-empty string');
    }

    try {
      const deploymentIds =
        this.storage.installationIndex.get(installationId) || [];

      if (deploymentIds.length === 0) {
        return null;
      }

      // Get latest deployment (last in array)
      const latestId = deploymentIds[deploymentIds.length - 1];
      return this.storage.deployments.get(latestId) || null;
    } catch (error) {
      throw new Error(
        `Failed to find latest deployment for installation ${installationId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * List deployments for an installation
   *
   * @param installationId - Installation ID
   * @param limit - Maximum number of deployments to return (default: 50)
   * @returns Array of DeploymentEntity objects, most recent first
   */
  async listByInstallation(
    installationId: string,
    limit: number = 50,
  ): Promise<DeploymentEntity[]> {
    if (!installationId || typeof installationId !== 'string') {
      throw new ValidationError('installationId must be a non-empty string');
    }

    if (typeof limit !== 'number' || limit < 1) {
      throw new ValidationError('limit must be a positive number');
    }

    try {
      const deploymentIds =
        this.storage.installationIndex.get(installationId) || [];

      // Sort in reverse order (most recent first)
      const recentIds = deploymentIds.slice(-limit).reverse();

      const deployments: DeploymentEntity[] = [];
      for (const id of recentIds) {
        const deployment = this.storage.deployments.get(id);
        if (deployment) {
          deployments.push(deployment);
        }
      }

      return deployments;
    } catch (error) {
      throw new Error(
        `Failed to list deployments for installation ${installationId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Delete all deployments for an installation
   * (Useful for cleanup/testing)
   */
  async deleteByInstallation(installationId: string): Promise<void> {
    if (!installationId || typeof installationId !== 'string') {
      throw new ValidationError('installationId must be a non-empty string');
    }

    try {
      const deploymentIds =
        this.storage.installationIndex.get(installationId) || [];

      for (const deploymentId of deploymentIds) {
        this.storage.deployments.delete(deploymentId);
      }

      this.storage.installationIndex.delete(installationId);
    } catch (error) {
      throw new Error(
        `Failed to delete deployments for installation ${installationId}`,
      );
    }
  }

  /**
   * Get repository statistics
   * (Useful for monitoring)
   */
  getStats(): {
    totalDeployments: number;
    installations: number;
  } {
    return {
      totalDeployments: this.storage.deployments.size,
      installations: this.storage.installationIndex.size,
    };
  }

  /**
   * Clear all data (useful for testing)
   */
  clearAll(): void {
    this.storage.deployments.clear();
    this.storage.installationIndex.clear();
  }
}
