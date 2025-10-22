/**
 * Deployment Service Interface
 * Defines contract for worker deployment operations
 */

export interface IDeploymentService {
  /**
   * Deploy worker to production
   */
  deploy(params: {
    version: string;
    configHash: string;
    installationId: string;
    workerCode: string;
  }): Promise<{ success: boolean; url: string }>;

  /**
   * Get deployment status
   */
  getStatus(deploymentId: string): Promise<{
    status: 'pending' | 'in-progress' | 'success' | 'failed';
    message?: string;
  }>;

  /**
   * Rollback to previous version
   */
  rollback(deploymentId: string, previousVersion: string): Promise<{ success: boolean }>;

  /**
   * Validate worker code before deployment
   */
  validate(workerCode: string): Promise<{ valid: boolean; errors?: string[] }>;
}
