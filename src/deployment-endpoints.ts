// Deployment API endpoints with container registry authentication
import type { Hono } from 'hono';
import type { Env } from './types';
import {
  containerAuthMiddleware,
  refreshAuthMiddleware,
  getAuthContext,
  AuthContext,
} from './auth-middleware';
import {
  getContainerRegistryAuthManager,
  ContainerAuthError,
} from './container-registry-auth';

/**
 * Deployment status
 */
export enum DeploymentStatus {
  INITIATED = 'initiated',
  CONFIGURING = 'configuring',
  AUTHENTICATED = 'authenticated',
  DEPLOYING = 'deploying',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Deployment request
 */
export interface DeploymentRequest {
  repositoryUrl: string;
  branch?: string;
  containerImage?: string;
  environmentVariables?: Record<string, string>;
}

/**
 * Deployment response
 */
export interface DeploymentResponse {
  success: boolean;
  deploymentId?: string;
  status?: DeploymentStatus;
  message?: string;
  error?: string;
  authHeaders?: Record<string, string>;
  registryUrl?: string;
  containerUrl?: string;
}

/**
 * Add deployment endpoints to the Hono app
 */
export function addDeploymentEndpoints(app: Hono<{ Bindings: Env }>) {
  // Pre-validate deployment authentication
  app.post('/api/deploy/validate', containerAuthMiddleware, async (c) => {
    try {
      const authContext = getAuthContext(c);
      if (!authContext) {
        return c.json({ error: 'Authentication context missing' }, 500);
      }

      const authResult = await authContext.authManager.preValidateAuth(
        authContext.userConfig,
      );

      if (!authResult.success) {
        return c.json(
          {
            success: false,
            error: authResult.error,
            message: authResult.message,
            retryable: authResult.retryable,
          },
          authResult.retryable ? 503 : 401,
        );
      }

      return c.json({
        success: true,
        message: 'Authentication validated successfully',
        expiresAt: authResult.auth?.expiresAt,
        registryUrl: authResult.auth?.registryUrl,
      });
    } catch (error) {
      console.error('Deploy validation error:', error);
      return c.json(
        {
          success: false,
          error: 'Validation failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        500,
      );
    }
  });

  // Initiate deployment process
  app.post(
    '/api/deploy/initiate',
    containerAuthMiddleware,
    refreshAuthMiddleware,
    async (c) => {
      try {
        const authContext = getAuthContext(c);
        if (!authContext) {
          return c.json({ error: 'Authentication context missing' }, 500);
        }

        const deploymentRequest = (await c.req.json()) as DeploymentRequest;

        // Validate required fields
        if (!deploymentRequest.repositoryUrl) {
          return c.json(
            {
              success: false,
              error: 'Missing required field',
              message: 'Repository URL is required',
            },
            400,
          );
        }

        // Generate deployment ID
        const deploymentId = generateDeploymentId(
          authContext.userConfig.userId,
        );

        // Get deployment authentication
        const authResult = await authContext.authManager.getDeploymentAuth(
          authContext.userConfig,
        );
        if (!authResult.success) {
          return c.json(
            {
              success: false,
              error: authResult.error,
              message: authResult.message,
              retryable: authResult.retryable,
            },
            authResult.retryable ? 503 : 401,
          );
        }

        // Store deployment configuration in Durable Object
        await storeDeploymentConfig(c.env, deploymentId, {
          userId: authContext.userConfig.userId,
          deploymentRequest,
          authHeaders: authResult.auth!.deploymentHeaders,
          registryUrl: authResult.auth!.registryUrl,
          status: DeploymentStatus.INITIATED,
          createdAt: new Date().toISOString(),
        });

        const response: DeploymentResponse = {
          success: true,
          deploymentId,
          status: DeploymentStatus.INITIATED,
          message: 'Deployment initiated successfully',
          authHeaders: authResult.auth!.deploymentHeaders,
          registryUrl: authResult.auth!.registryUrl,
        };

        return c.json(response);
      } catch (error) {
        console.error('Deploy initiate error:', error);
        return c.json(
          {
            success: false,
            error: 'Deployment initiation failed',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
          500,
        );
      }
    },
  );

  // Execute deployment
  app.post('/api/deploy/execute', containerAuthMiddleware, async (c) => {
    try {
      const { deploymentId } = (await c.req.json()) as { deploymentId: string };

      if (!deploymentId) {
        return c.json(
          {
            success: false,
            error: 'Missing deployment ID',
          },
          400,
        );
      }

      const authContext = getAuthContext(c);
      if (!authContext) {
        return c.json({ error: 'Authentication context missing' }, 500);
      }

      // Get deployment configuration
      const deploymentConfig = await getDeploymentConfig(c.env, deploymentId);
      if (!deploymentConfig) {
        return c.json(
          {
            success: false,
            error: 'Deployment not found',
          },
          404,
        );
      }

      // Verify user owns this deployment
      if (deploymentConfig.userId !== authContext.userConfig.userId) {
        return c.json(
          {
            success: false,
            error: 'Unauthorized access to deployment',
          },
          403,
        );
      }

      // Update status to deploying
      await updateDeploymentStatus(
        c.env,
        deploymentId,
        DeploymentStatus.DEPLOYING,
      );

      // Simulate deployment execution
      // In real implementation, this would trigger the actual deployment
      const deploymentResult =
        await executeContainerDeployment(deploymentConfig);

      if (deploymentResult.success) {
        await updateDeploymentStatus(
          c.env,
          deploymentId,
          DeploymentStatus.COMPLETED,
        );
        return c.json({
          success: true,
          deploymentId,
          status: DeploymentStatus.COMPLETED,
          message: 'Deployment completed successfully',
          containerUrl: deploymentResult.containerUrl,
        });
      } else {
        await updateDeploymentStatus(
          c.env,
          deploymentId,
          DeploymentStatus.FAILED,
        );
        return c.json(
          {
            success: false,
            deploymentId,
            status: DeploymentStatus.FAILED,
            error: deploymentResult.error,
            message: deploymentResult.message,
          },
          500,
        );
      }
    } catch (error) {
      console.error('Deploy execute error:', error);
      return c.json(
        {
          success: false,
          error: 'Deployment execution failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        500,
      );
    }
  });

  // Get deployment status
  app.get(
    '/api/deploy/status/:deploymentId',
    containerAuthMiddleware,
    async (c) => {
      try {
        const deploymentId = c.req.param('deploymentId');
        const authContext = getAuthContext(c);

        if (!authContext) {
          return c.json({ error: 'Authentication context missing' }, 500);
        }

        const deploymentConfig = await getDeploymentConfig(c.env, deploymentId);
        if (!deploymentConfig) {
          return c.json(
            {
              success: false,
              error: 'Deployment not found',
            },
            404,
          );
        }

        // Verify user owns this deployment
        if (deploymentConfig.userId !== authContext.userConfig.userId) {
          return c.json(
            {
              success: false,
              error: 'Unauthorized access to deployment',
            },
            403,
          );
        }

        return c.json({
          success: true,
          deploymentId,
          status: deploymentConfig.status,
          createdAt: deploymentConfig.createdAt,
          updatedAt: deploymentConfig.updatedAt,
          repositoryUrl: deploymentConfig.deploymentRequest.repositoryUrl,
          containerUrl: deploymentConfig.containerUrl,
        });
      } catch (error) {
        console.error('Deploy status error:', error);
        return c.json(
          {
            success: false,
            error: 'Failed to get deployment status',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
          500,
        );
      }
    },
  );

  // Handle deployment authentication failures
  app.post(
    '/api/deploy/handle-auth-failure',
    containerAuthMiddleware,
    async (c) => {
      try {
        const { deploymentId, error } = (await c.req.json()) as {
          deploymentId: string;
          error: any;
        };

        const authContext = getAuthContext(c);
        if (!authContext) {
          return c.json({ error: 'Authentication context missing' }, 500);
        }

        // Handle the authentication failure
        const authResult =
          await authContext.authManager.handleDeploymentAuthFailure(
            authContext.userConfig,
            error,
          );

        if (authResult.success) {
          // Update deployment config with new auth
          await updateDeploymentAuth(c.env, deploymentId, {
            authHeaders: authResult.auth!.deploymentHeaders,
            registryUrl: authResult.auth!.registryUrl,
          });

          return c.json({
            success: true,
            message: 'Authentication recovered successfully',
            authHeaders: authResult.auth!.deploymentHeaders,
            registryUrl: authResult.auth!.registryUrl,
          });
        } else {
          await updateDeploymentStatus(
            c.env,
            deploymentId,
            DeploymentStatus.FAILED,
          );

          return c.json(
            {
              success: false,
              error: authResult.error,
              message: authResult.message,
              retryable: authResult.retryable,
            },
            authResult.retryable ? 503 : 401,
          );
        }
      } catch (error) {
        console.error('Deploy auth failure handler error:', error);
        return c.json(
          {
            success: false,
            error: 'Failed to handle authentication failure',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
          500,
        );
      }
    },
  );
}

/**
 * Generate unique deployment ID
 */
function generateDeploymentId(userId: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return `deploy-${userId}-${timestamp}-${random}`;
}

/**
 * Store deployment configuration in Durable Object
 */
async function storeDeploymentConfig(
  env: Env,
  deploymentId: string,
  config: any,
): Promise<void> {
  try {
    const id = env.USER_CONFIG.idFromName('deployment-config');
    const deploymentDO = env.USER_CONFIG.get(id);

    await deploymentDO.fetch(
      new Request(`http://localhost/deployment/${deploymentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      }),
    );
  } catch (error) {
    console.error('Error storing deployment config:', error);
    throw error;
  }
}

/**
 * Get deployment configuration from Durable Object
 */
async function getDeploymentConfig(
  env: Env,
  deploymentId: string,
): Promise<any | null> {
  try {
    const id = env.USER_CONFIG.idFromName('deployment-config');
    const deploymentDO = env.USER_CONFIG.get(id);

    const response = await deploymentDO.fetch(
      new Request(`http://localhost/deployment/${deploymentId}`),
    );

    if (response.ok) {
      return await response.json();
    }

    return null;
  } catch (error) {
    console.error('Error getting deployment config:', error);
    return null;
  }
}

/**
 * Update deployment status
 */
async function updateDeploymentStatus(
  env: Env,
  deploymentId: string,
  status: DeploymentStatus,
): Promise<void> {
  try {
    const id = env.USER_CONFIG.idFromName('deployment-config');
    const deploymentDO = env.USER_CONFIG.get(id);

    await deploymentDO.fetch(
      new Request(`http://localhost/deployment/${deploymentId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, updatedAt: new Date().toISOString() }),
      }),
    );
  } catch (error) {
    console.error('Error updating deployment status:', error);
    throw error;
  }
}

/**
 * Update deployment authentication
 */
async function updateDeploymentAuth(
  env: Env,
  deploymentId: string,
  auth: any,
): Promise<void> {
  try {
    const id = env.USER_CONFIG.idFromName('deployment-config');
    const deploymentDO = env.USER_CONFIG.get(id);

    await deploymentDO.fetch(
      new Request(`http://localhost/deployment/${deploymentId}/auth`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(auth),
      }),
    );
  } catch (error) {
    console.error('Error updating deployment auth:', error);
    throw error;
  }
}

/**
 * Execute container deployment (simulation)
 */
async function executeContainerDeployment(config: any): Promise<{
  success: boolean;
  error?: string;
  message?: string;
  containerUrl?: string;
}> {
  try {
    console.log(
      'Executing container deployment:',
      config.deploymentRequest.repositoryUrl,
    );

    // Simulate deployment process
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // For demo purposes, simulate success
    const containerUrl = `https://${config.deploymentId}.${config.userId}.workers.dev`;

    return {
      success: true,
      containerUrl,
      message: 'Container deployed successfully',
    };
  } catch (error) {
    return {
      success: false,
      error: 'Deployment execution failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
