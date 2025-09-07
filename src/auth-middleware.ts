// Authentication middleware for container deployment
import type { Context, Next } from 'hono';
import type { Env, UserConfig } from './types';
import { getContainerRegistryAuthManager, ContainerAuthError } from './container-registry-auth';
import { getUserConfigDO } from './user-endpoints';

/**
 * Authentication context added to requests
 */
export interface AuthContext {
  userConfig: UserConfig;
  containerAuthValid: boolean;
  authManager: any;
}

/**
 * Middleware to validate container deployment authentication
 */
export async function containerAuthMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  try {
    const userId = c.req.header('X-User-ID') || c.req.query('userId');
    if (!userId) {
      return c.json({ 
        error: 'Missing user ID',
        message: 'User ID is required for authenticated endpoints'
      }, 401);
    }

    // Get user configuration
    const userConfigDO = getUserConfigDO(c.env);
    const userConfig = await getUserConfigFromDO(userConfigDO, userId);
    
    if (!userConfig) {
      return c.json({
        error: 'User not found',
        message: `User ${userId} is not registered`
      }, 404);
    }

    if (!userConfig.isActive) {
      return c.json({
        error: 'User account inactive',
        message: `User ${userId} account is deactivated`
      }, 403);
    }

    // Create auth manager and validate container auth
    const authManager = getContainerRegistryAuthManager(c.env);
    const authResult = await authManager.preValidateAuth(userConfig);

    if (!authResult.success) {
      console.error(`Container auth failed for user ${userId}:`, authResult.error);
      
      // Determine appropriate response based on error type
      let statusCode = 500;
      let errorMessage = 'Authentication failed';
      
      switch (authResult.error) {
        case ContainerAuthError.TOKEN_GENERATION_FAILED:
          statusCode = 401;
          errorMessage = 'Failed to generate authentication tokens';
          break;
        case ContainerAuthError.REGISTRY_ACCESS_DENIED:
          statusCode = 403;
          errorMessage = 'Access denied to container registry';
          break;
        case ContainerAuthError.VALIDATION_FAILED:
          statusCode = 401;
          errorMessage = 'Authentication validation failed';
          break;
        case ContainerAuthError.NETWORK_ERROR:
          statusCode = 503;
          errorMessage = 'Network error during authentication';
          break;
        case ContainerAuthError.CLOUDFLARE_API_ERROR:
          statusCode = 502;
          errorMessage = 'Cloudflare API error';
          break;
      }

      return c.json({
        error: 'Authentication failed',
        message: errorMessage,
        retryable: authResult.retryable,
        details: authResult.message
      }, statusCode);
    }

    // Add auth context to the request
    const authContext: AuthContext = {
      userConfig,
      containerAuthValid: true,
      authManager
    };

    // Store in context for use in handlers
    c.set('authContext', authContext);

    await next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return c.json({
      error: 'Authentication error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * Get user configuration from Durable Object
 */
async function getUserConfigFromDO(userConfigDO: any, userId: string): Promise<UserConfig | null> {
  try {
    const response = await userConfigDO.fetch(
      new Request(`http://localhost/user/${userId}`)
    );

    if (response.ok) {
      return await response.json() as UserConfig;
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting user config for ${userId}:`, error);
    return null;
  }
}

/**
 * Middleware to refresh authentication if needed
 */
export async function refreshAuthMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  try {
    const authContext = c.get('authContext') as AuthContext;
    if (!authContext) {
      return c.json({ error: 'Authentication context missing' }, 500);
    }

    // Check if refresh is needed (token expiring within 15 minutes)
    const authResult = await authContext.authManager.getDeploymentAuth(authContext.userConfig);
    
    if (authResult.success && authResult.auth) {
      const expiresAt = new Date(authResult.auth.expiresAt).getTime();
      const now = Date.now();
      const fifteenMinutes = 15 * 60 * 1000;
      
      if (expiresAt - now < fifteenMinutes) {
        console.log(`🔄 Refreshing auth for user ${authContext.userConfig.userId} (expires soon)`);
        
        const refreshResult = await authContext.authManager.refreshAuth(authContext.userConfig);
        if (!refreshResult.success) {
          console.error(`Failed to refresh auth for user ${authContext.userConfig.userId}`);
          return c.json({
            error: 'Authentication refresh failed',
            message: refreshResult.message,
            retryable: refreshResult.retryable
          }, 401);
        }
        
        console.log(`✅ Auth refreshed for user ${authContext.userConfig.userId}`);
      }
    }

    await next();
  } catch (error) {
    console.error('Refresh auth middleware error:', error);
    return c.json({
      error: 'Authentication refresh error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * Get auth context from request
 */
export function getAuthContext(c: Context): AuthContext | null {
  return c.get('authContext') as AuthContext || null;
}

/**
 * Quick validation middleware for non-critical endpoints
 */
export async function quickAuthValidation(c: Context<{ Bindings: Env }>, next: Next) {
  try {
    const userId = c.req.header('X-User-ID') || c.req.query('userId');
    if (!userId) {
      return c.json({ error: 'Missing user ID' }, 401);
    }

    // Just verify user exists and is active
    const userConfigDO = getUserConfigDO(c.env);
    const userConfig = await getUserConfigFromDO(userConfigDO, userId);
    
    if (!userConfig || !userConfig.isActive) {
      return c.json({ error: 'User not authorized' }, 401);
    }

    // Add minimal context
    c.set('userConfig', userConfig);
    await next();
  } catch (error) {
    console.error('Quick auth validation error:', error);
    return c.json({ error: 'Authentication error' }, 500);
  }
}

/**
 * Webhook authentication middleware
 */
export async function webhookAuthMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  try {
    const body = await c.req.text();
    const signature = c.req.header("X-Hub-Signature-256");
    
    if (!signature) {
      return c.json({ error: "Missing signature" }, 400);
    }

    // Import the validation function here to avoid circular dependencies
    const { validateWebhookSignature } = await import('./github-utils');
    const isValidSignature = await validateWebhookSignature(body, signature);
    
    if (!isValidSignature) {
      console.error("Invalid webhook signature");
      return c.json({ error: "Invalid signature" }, 401);
    }

    // Re-create request with the body for downstream handlers
    const newRequest = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers: c.req.raw.headers,
      body: body
    });
    c.req = {
      ...c.req,
      raw: newRequest,
      text: () => Promise.resolve(body),
      json: () => Promise.resolve(JSON.parse(body))
    } as any;

    await next();
  } catch (error) {
    console.error('Webhook auth middleware error:', error);
    return c.json({ error: 'Webhook authentication failed' }, 401);
  }
}