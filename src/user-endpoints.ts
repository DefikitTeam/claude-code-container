// User management endpoints for multi-tenant deployment
import { Hono } from 'hono';
import {
  Env,
  UserConfig,
  UserRegistrationRequest,
  UserRegistrationResponse,
  RegistrationSummary,
  UserDeletionResponse,
  InstallationDirectory,
} from './types';
import { getFixedGitHubAppConfig } from './app-config';
import { createJWT } from './github-utils';
import { validateAnthropicApiKey } from './api-key-validator';

export function addUserEndpoints(app: Hono<{ Bindings: Env }>) {
  /**
   * Register a new user with Installation ID and Anthropic API key
   * POST /register-user
   */
  app.post('/register-user', async (c) => {
    try {
      console.log('=== USER REGISTRATION REQUEST ===');

      // Parse body supporting both JSON and form-encoded payloads
      const contentType = (c.req.header('content-type') || '').toLowerCase();
      const isJson = contentType.includes('application/json');
      const isFormUrlEncoded = contentType.includes(
        'application/x-www-form-urlencoded',
      );
      const isMultipart = contentType.includes('multipart/form-data');

      const normalizeValue = (value: unknown): string => {
        if (Array.isArray(value)) {
          return normalizeValue(value[0]);
        }
        if (typeof File !== 'undefined' && value instanceof File) {
          return value.name ?? '';
        }
        if (value === null || value === undefined) {
          return '';
        }
        return String(value);
      };

      let registrationRequest: UserRegistrationRequest;
      try {
        if (isFormUrlEncoded || isMultipart) {
          const formBody = await c.req.parseBody();
          registrationRequest = {
            installationId: normalizeValue(formBody['installationId']).trim(),
            anthropicApiKey: normalizeValue(formBody['anthropicApiKey']).trim(),
            userId: (() => {
              const raw = normalizeValue(formBody['userId']).trim();
              return raw.length > 0 ? raw : undefined;
            })(),
            projectLabel: (() => {
              const raw = normalizeValue(formBody['projectLabel']).trim();
              return raw.length > 0 ? raw : undefined;
            })(),
          };
        } else {
          // Default to JSON. Cloudflare sets charset in header, so check includes above handles variants.
          registrationRequest = (await c.req.json()) as UserRegistrationRequest;
          registrationRequest.installationId = (registrationRequest.installationId || '').trim();
          registrationRequest.anthropicApiKey = (registrationRequest.anthropicApiKey || '').trim();
          if (registrationRequest.userId) {
            registrationRequest.userId = registrationRequest.userId.trim();
          }
          if (registrationRequest.projectLabel) {
            registrationRequest.projectLabel = registrationRequest.projectLabel.trim();
          }
        }
      } catch (parseErr) {
        console.error('Body parse error:', parseErr);
        return c.json(
          {
            success: false,
            error: 'Invalid request body',
            message:
              'Ensure the body is valid JSON or form data with installationId, anthropicApiKey, and optional userId fields.',
            receivedContentType: contentType || 'unknown',
          },
          400,
        );
      }

      console.log('Registration request:', {
        installationId: registrationRequest.installationId,
        hasApiKey: !!registrationRequest.anthropicApiKey,
        hasUserId: !!registrationRequest.userId,
      });

      // Validate required fields
      if (
        !registrationRequest.installationId ||
        !registrationRequest.anthropicApiKey
      ) {
        return c.json(
          {
            success: false,
            error: 'installationId and anthropicApiKey are required',
          },
          400,
        );
      }

      // Validate Anthropic API key format and functionality
      console.log('Validating Anthropic API key...');
      const apiKeyValidation = await validateAnthropicApiKey(
        registrationRequest.anthropicApiKey,
        true,
      );
      if (!apiKeyValidation.valid) {
        return c.json(
          {
            success: false,
            error: `Invalid Anthropic API key: ${apiKeyValidation.error}`,
            details: {
              formatValid: apiKeyValidation.formatValid,
              functionalityValid: apiKeyValidation.functionalityValid,
            },
          },
          400,
        );
      }
      console.log('✅ Anthropic API key validated successfully');

      // Validate the installation ID with GitHub
      // NOTE: Installation validation via GitHub API has been intentionally
      // disabled here. Operators should configure the GitHub App credentials
      // using the operator `/config` endpoint (or environment variables) so
      // the service can manage installation tokens centrally. This avoids
      // requiring an outbound GitHub validation call at registration time
      // which simplifies onboarding and offline registration flows.
      console.log(
        '📌 Skipping live GitHub installation validation for',
        registrationRequest.installationId,
      );

      // Get UserConfigDO instance
      const userConfigDO = getUserConfigDO(c.env);

      // Register the user
      const response = await userConfigDO.fetch(
        new Request('http://localhost/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(registrationRequest),
        }),
      );

      if (!response.ok) {
        const error = (await response.json()) as Record<string, unknown> | null;
        return c.json(
          {
            success: false,
            error: (error?.error as string) || 'Registration failed',
            registrations: (error?.registrations as RegistrationSummary[]) || undefined,
            details: error,
          },
          response.status as any,
        );
      }

      const result = (await response.json()) as UserRegistrationResponse;
      console.log(`✅ User registered successfully: ${result.userId}`);

      return c.json(
        {
          success: true,
          userId: result.userId,
          installationId: result.installationId,
          projectLabel: result.projectLabel ?? null,
          existingRegistrations: result.existingRegistrations,
          message:
            result.message ??
            'User registered successfully. You can now deploy your Worker with these credentials.',
          nextSteps: {
            step1:
              'Deploy your Cloudflare Worker with the provided userId and installationId',
            step2: 'Configure your wrangler.jsonc with the USER_CONFIG binding',
            step3: 'Set environment variables for ANTHROPIC_API_KEY',
            step4: 'Test your integration with a GitHub issue',
          },
        },
        201,
      );
    } catch (error) {
      console.error('User registration error:', error);
      return c.json(
        {
          success: false,
          error: 'Registration failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
        500,
      );
    }
  });

  /**
   * Get user configuration
   * GET /user-config/:userId
   */
  app.get('/user-config/:userId', async (c) => {
    try {
      const userId = c.req.param('userId');

      if (!userId) {
        return c.json(
          {
            success: false,
            error: 'userId parameter is required',
          },
          400,
        );
      }

      const userConfigDO = getUserConfigDO(c.env);
      const response = await userConfigDO.fetch(
        new Request(`http://localhost/user?userId=${userId}`),
      );

      if (!response.ok) {
        const error = (await response.json()) as any;
        return c.json(
          {
            success: false,
            error: error?.error || 'User not found',
          },
          response.status as any,
        );
      }

      const userConfig: UserConfig = (await response.json()) as any;

      // Return safe user configuration (hide sensitive data)
      return c.json({
        success: true,
        user: {
          userId: userConfig.userId,
          installationId: userConfig.installationId,
          hasAnthropicApiKey: !!userConfig.anthropicApiKey,
          repositoryAccess: userConfig.repositoryAccess,
          created: userConfig.created,
          updated: userConfig.updated,
          isActive: userConfig.isActive,
          projectLabel: userConfig.projectLabel ?? null,
        },
        existingRegistrations: userConfig.existingRegistrations ?? [],
      });
    } catch (error) {
      console.error('Get user config error:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to retrieve user configuration',
        },
        500,
      );
    }
  });

  /**
   * Update user configuration
   * PUT /user-config/:userId
   */
  app.put('/user-config/:userId', async (c) => {
    try {
      const userId = c.req.param('userId');
      const updateData = await c.req.json();

      if (!userId) {
        return c.json(
          {
            success: false,
            error: 'userId parameter is required',
          },
          400,
        );
      }

      const userConfigDO = getUserConfigDO(c.env);
      const response = await userConfigDO.fetch(
        new Request('http://localhost/user', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, ...updateData }),
        }),
      );

      if (!response.ok) {
        const error = (await response.json()) as any;
        return c.json(
          {
            success: false,
            error: error?.error || 'Update failed',
          },
          response.status as any,
        );
      }

      return c.json({
        success: true,
        message: 'User configuration updated successfully',
      });
    } catch (error) {
      console.error('Update user config error:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to update user configuration',
        },
        500,
      );
    }
  });

  /**
   * Delete user configuration
   * DELETE /user-config/:userId
   */
  app.delete('/user-config/:userId', async (c) => {
    try {
      const userId = c.req.param('userId');

      if (!userId) {
        return c.json(
          {
            success: false,
            error: 'userId parameter is required',
          },
          400,
        );
      }

      const userConfigDO = getUserConfigDO(c.env);
      const response = await userConfigDO.fetch(
        new Request(`http://localhost/user?userId=${userId}`, {
          method: 'DELETE',
        }),
      );

      if (!response.ok) {
        const error = (await response.json()) as Record<string, unknown> | null;
        return c.json(
          {
            success: false,
            error: (error?.error as string) || 'Delete failed',
            remainingRegistrations: (error?.remainingRegistrations as RegistrationSummary[]) || undefined,
          },
          response.status as any,
        );
      }

      const result = (await response.json()) as UserDeletionResponse;

      return c.json({
        success: true,
        message: result.message ?? 'User configuration deleted successfully',
        removedUserId: result.removedUserId,
        installationId: result.installationId,
        remainingRegistrations: result.remainingRegistrations,
      });
    } catch (error) {
      console.error('Delete user config error:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to delete user configuration',
        },
        500,
      );
    }
  });

  /**
   * List all users (admin endpoint)
   * GET /users
   */
  app.get('/users', async (c) => {
    try {
      const userConfigDO = getUserConfigDO(c.env);
      const response = await userConfigDO.fetch(
        new Request('http://localhost/users'),
      );

      if (!response.ok) {
        return c.json(
          { success: false, error: 'Failed to list users' },
          500 as any,
        );
      }

      const result = (await response.json()) as any;
      return c.json({
        success: true,
        users: result.users,
        count: result.count,
      });
    } catch (error) {
      console.error('List users error:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to list users',
        },
        500,
      );
    }
  });

  /**
   * Get user by installation ID (internal endpoint for webhook processing)
   * GET /internal/user-by-installation/:installationId
   */
  app.get('/internal/user-by-installation/:installationId', async (c) => {
    try {
      const installationId = c.req.param('installationId');

      if (!installationId) {
        return c.json(
          {
            success: false,
            error: 'installationId parameter is required',
          },
          400,
        );
      }

      const userConfigDO = getUserConfigDO(c.env);
      const response = await userConfigDO.fetch(
        new Request(
          `http://localhost/user-by-installation?installationId=${installationId}`,
        ),
      );

      if (!response.ok) {
        const error = (await response.json()) as Record<string, unknown> | null;
        return c.json(
          {
            success: false,
            error: (error?.error as string) || 'User not found',
          },
          response.status as any,
        );
      }

      const directory = (await response.json()) as InstallationDirectory;
      const registrations = directory.registrations ?? [];

      if (registrations.length === 0) {
        return c.json(
          {
            success: false,
            error: 'User not found for installation ID',
          },
          404 as any,
        );
      }

      if (registrations.length > 1) {
        return c.json(
          {
            success: false,
            error:
              'Multiple registrations found for installation. Provide userId to disambiguate.',
            registrations,
          },
          409 as any,
        );
      }

      const targetUserId = registrations[0]?.userId;
      if (!targetUserId) {
        return c.json(
          {
            success: false,
            error: 'User not found for installation ID',
          },
          404 as any,
        );
      }

      const userResponse = await userConfigDO.fetch(
        new Request(`http://localhost/user?userId=${targetUserId}`),
      );

      if (!userResponse.ok) {
        const error = (await userResponse.json()) as Record<string, unknown> | null;
        return c.json(
          {
            success: false,
            error: (error?.error as string) || 'User not found',
          },
          userResponse.status as any,
        );
      }

      const userConfig: UserConfig = (await userResponse.json()) as any;
      return c.json({
        success: true,
        user: userConfig,
        registrations,
      });
    } catch (error) {
      console.error('Get user by installation error:', error);
      return c.json(
        {
          success: false,
          error: 'Failed to retrieve user by installation ID',
        },
        500,
      );
    }
  });
}

/**
 * Helper function to get UserConfigDO instance
 */
export function getUserConfigDO(env: Env) {
  const id = env.USER_CONFIG.idFromName('user-config');
  return env.USER_CONFIG.get(id);
}

/**
 * Validate installation ID with GitHub API
 */
async function validateInstallationId(
  installationId: string,
): Promise<boolean> {
  try {
    const appConfig = getFixedGitHubAppConfig();

    // Create JWT for GitHub App authentication
    const jwt = await createJWT(appConfig.appId, appConfig.privateKey);

    // Check if installation exists and is accessible
    const apiUrl = `https://api.github.com/app/installations/${installationId}`;
    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'claude-code-containers/1.0.0',
      },
    });

    if (response.ok) {
      const installation = (await response.json()) as any;
      console.log(
        `✅ Installation validated: ${installation?.account?.login} (${installation?.account?.type})`,
      );
      return true;
    } else {
      console.error(
        `❌ Installation validation failed: ${response.status} ${response.statusText}`,
      );
      return false;
    }
  } catch (error) {
    console.error('Installation validation error:', error);
    return false;
  }
}
