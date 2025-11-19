/**
 * NotFoundError - Error thrown when a resource is not found
 * HTTP Status: 404 Not Found
 */

import { BaseError } from './base.error';

export class NotFoundError extends BaseError {
  public readonly resourceType: string;
  public readonly resourceId?: string | number;

  constructor(
    resourceType: string,
    resourceId?: string | number,
    message?: string,
    details?: Record<string, unknown>,
  ) {
    const defaultMessage =
      message ||
      `${resourceType}${resourceId ? ` with ID ${resourceId}` : ''} not found`;

    super(
      defaultMessage,
      'NOT_FOUND_ERROR',
      404,
      { resourceType, resourceId, ...details },
      true, // operational error - safe to expose
    );

    this.resourceType = resourceType;
    this.resourceId = resourceId;
  }

  /**
   * Factory method for common not-found errors
   */
  static user(userId: string): NotFoundError {
    return new NotFoundError('User', userId);
  }

  static installation(installationId: string): NotFoundError {
    return new NotFoundError('Installation', installationId);
  }

  static repository(repoName: string): NotFoundError {
    return new NotFoundError('Repository', repoName);
  }

  static deployment(deploymentId: string): NotFoundError {
    return new NotFoundError('Deployment', deploymentId);
  }

  static generic(resource: string): NotFoundError {
    return new NotFoundError(resource);
  }
}
