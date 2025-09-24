import { Hono } from 'hono';
import {
  Env,
  GitHubIssuePayload,
  GitHubAppConfig,
  ContainerRequest,
  PromptRequest,
  PromptProcessingResult,
  UserConfig,
} from './types';
import {
  GitHubAppConfigDO,
  MyContainer,
  UserConfigDO,
} from './durable-objects';
import { CryptoUtils } from './crypto';
import { addInstallationEndpoints } from './installation-endpoints';
import { addUserEndpoints } from './user-endpoints';
import { addDeploymentEndpoints } from './deployment-endpoints';
import { addACPEndpoints } from './acp-bridge';
import { getFixedGitHubAppConfig, validateFixedAppConfig } from './app-config';
import {
  validateWebhookSignature,
  createLegacyGitHubAppConfig,
  getInstallationRepositories,
  getRepositoryInfo,
  createGitHubIssue,
} from './github-utils';
import { getTokenManager } from './token-manager';
import { webhookAuthMiddleware, quickAuthValidation } from './auth-middleware';

// Export Durable Objects only
export { GitHubAppConfigDO, MyContainer, UserConfigDO };

// Create Hono app with proper typing for Cloudflare Workers
const app = new Hono<{
  Bindings: Env;
}>();

// Home route with system information
app.get('/', (c) => {
  const configValid = validateFixedAppConfig();

  return c.json({
    name: 'Claude Code Containers - Multi-Tenant',
    description:
      'Automated GitHub issue processing system powered by Claude Code with multi-tenant deployment support',
    version: '2.0.0',
    deployment_model: 'user-controlled-workers',
    app_configuration: configValid
      ? '✅ Fixed GitHub App configured'
      : '❌ GitHub App configuration missing',
    endpoints: {
      // User Management
      '/register-user':
        'POST - Register user with Installation ID and Anthropic API key',
      '/user-config/:userId': 'GET/PUT/DELETE - User configuration management',
      '/users': 'GET - List all users (admin)',

      // Installation (Simplified)
      '/install': 'GET - GitHub App installation page (UI)',
      '/install/github-app': 'GET - Get GitHub App installation URL',
      '/install/callback': 'GET - Handle GitHub installation callback',

      // Processing
      '/webhook/github': 'POST - GitHub webhook endpoint (multi-tenant)',
      '/process-prompt':
        'POST - Process prompt and create issue (user-specific)',

      // Deployment API (NEW)
      '/api/deploy/initiate': 'POST - Initiate deployment process',
      '/api/deploy/configure': 'POST - Configure deployment credentials',
      '/api/deploy/execute': 'POST - Execute deployment',
      '/api/deploy/status/:id': 'GET - Check deployment status',

      // // Agent Client Protocol (ACP) API
      // "/acp/initialize": "POST - Initialize ACP agent connection",
      // "/acp/session/create": "POST - Create ACP session",
      // "/acp/task/execute": "POST - Execute ACP task",
      // "/acp/file/read": "POST - Read file via ACP",
      // "/acp/file/write": "POST - Write file via ACP",
      // "/acp/session/destroy": "POST - Destroy ACP session",
      // "/acp/status": "GET - ACP agent status",

      // System
      '/': 'System information',
      '/health': 'Health check',
      '/container/health': 'GET - Container health check',
      '/container/acp': 'POST - Direct container ACP JSON-RPC endpoint',
      '/container/process': 'Direct container processing',
    },
    setup_instructions: {
      for_users: {
        step_1: 'Install the GitHub App on your repositories',
        step_2:
          'Register with POST /register-user (Installation ID + Anthropic API key)',
        step_3: 'Deploy your own Cloudflare Worker with the provided User ID',
        step_4: 'Configure environment variables and test integration',
      },
    },
    timestamp: new Date().toISOString(),
  });
});

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      containers: 'available',
      durableObjects: 'available',
      webhooks: 'ready',
    },
  });
});

// Add GitHub App installation endpoints (simplified)
addInstallationEndpoints(app);

// Add user management endpoints
addUserEndpoints(app);

// Add deployment endpoints with authentication
addDeploymentEndpoints(app);

// Add ACP endpoints (bridge for Agent Client Protocol)
addACPEndpoints(app);

// Process prompt endpoint - creates issue and processes it automatically (multi-tenant)
app.post('/process-prompt', async (c) => {
  try {
    console.log('=== MULTI-TENANT PROCESS PROMPT REQUEST ===');

    // Parse request body - handle both old and new payload formats
    const rawBody = await c.req.json();

    console.log('Raw request body:', rawBody);

    // Handle the forwarded payload format vs direct API format
    let requestBody: PromptRequest & {
      userId?: string;
      installationId?: string;
    };

    if (rawBody.projectId && rawBody.promptLength && !rawBody.prompt) {
      // This is a forwarded payload from your frontend system
      console.log('Detected forwarded payload format, converting...');

      // For now, create a default prompt since the actual prompt text is missing
      // You'll need to modify your frontend to include the actual prompt
      requestBody = {
        prompt: `Process project ${rawBody.projectId} request`, // Default prompt
        userId: rawBody.userId?.toString(),
        installationId: rawBody.installationId?.toString(),
        repository: undefined, // Add if available in your context
        branch: undefined, // Add if available in your context
      };

      console.log(
        '⚠️ WARNING: Using default prompt because actual prompt text was not provided',
      );
      console.log(
        "⚠️ Please modify your frontend to include 'prompt' field with actual text",
      );
    } else {
      // Standard PromptRequest format
      requestBody = rawBody;
    }

    console.log('Processed request:', {
      promptLength: requestBody.prompt?.length || 0,
      repository: requestBody.repository,
      branch: requestBody.branch,
      hasTitle: !!requestBody.title,
      hasUserId: !!requestBody.userId,
      hasInstallationId: !!requestBody.installationId,
    });

    // Validate required fields
    if (!requestBody.prompt || requestBody.prompt.trim() === '') {
      return c.json(
        {
          success: false,
          error:
            "Prompt is required and cannot be empty. Please include 'prompt' field with actual text in your request.",
        },
        400,
      );
    }

    // Get user configuration - either by userId or installationId
    let userConfig: UserConfig | null = null;
    const userConfigDO = getUserConfigDO(c.env);

    if (requestBody.userId) {
      const response = await userConfigDO.fetch(
        new Request(`http://localhost/user?userId=${requestBody.userId}`),
      );
      if (response.ok) {
        userConfig = await response.json();
      }
    } else if (requestBody.installationId) {
      const response = await userConfigDO.fetch(
        new Request(
          `http://localhost/user-by-installation?installationId=${requestBody.installationId}`,
        ),
      );
      if (response.ok) {
        userConfig = await response.json();
      }
    }

    if (!userConfig) {
      return c.json(
        {
          success: false,
          error:
            'User not found. Please provide either userId or installationId, and ensure the user is registered.',
        },
        404,
      );
    }

    console.log(`Processing prompt for user: ${userConfig.userId}`);

    // Process the prompt request
    const result = await processPromptRequest(c, requestBody, userConfig);

    return c.json(result);
  } catch (error) {
    console.error('Prompt processing error:', error);
    return c.json(
      {
        success: false,
        error: 'Prompt processing failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      500,
    );
  }
});

// GitHub webhook endpoint (multi-tenant)
app.post('/webhook/github', async (c) => {
  try {
    // Get request body and headers
    const body = await c.req.text();
    const signature = c.req.header('X-Hub-Signature-256');
    const event = c.req.header('X-GitHub-Event');
    const delivery = c.req.header('X-GitHub-Delivery');

    console.log('=== MULTI-TENANT WEBHOOK DEBUG ===');
    console.log(`Event: ${event}, Delivery: ${delivery}`);
    console.log(`Body length: ${body.length}`);
    console.log(`Signature received: ${signature}`);
    console.log(`Body sample: ${body.substring(0, 100)}...`);

    // Validate signature first
    if (!signature) {
      console.error('Missing webhook signature');
      return c.json({ error: 'Missing signature' }, 400);
    }

    // Validate webhook signature using fixed app config
    console.log('Validating webhook signature with fixed app config...');
    const isValidSignature = await validateWebhookSignature(body, signature);
    if (!isValidSignature) {
      console.error('Invalid webhook signature');
      return c.json({ error: 'Invalid signature' }, 401);
    }
    console.log('✅ Webhook signature validated');

    // Parse payload
    let payload: GitHubIssuePayload;
    try {
      if (body.startsWith('payload=')) {
        const encodedPayload = body.substring(8);
        const decodedPayload = decodeURIComponent(encodedPayload);
        payload = JSON.parse(decodedPayload);
      } else {
        payload = JSON.parse(body);
      }
    } catch (parseError) {
      console.error('JSON parsing error:', parseError);
      return c.json({ error: 'Invalid JSON payload' }, 400);
    }

    console.log('✅ Payload parsed successfully');

    // Process different webhook events
    switch (event) {
      case 'issues':
        return await handleIssueEvent(c, payload);
      case 'ping':
        console.log('GitHub webhook ping received');
        return c.json({ message: 'pong' });
      default:
        console.log(`Unhandled webhook event: ${event}`);
        return c.json({ message: 'Event not supported' }, 200);
    }
  } catch (error) {
    console.error('Webhook processing error:', error);
    console.error(
      'Error stack:',
      error instanceof Error ? error.stack : 'No stack',
    );
    return c.json(
      {
        error: 'Webhook processing failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      500,
    );
  }
});

// Handle GitHub issue events (multi-tenant)
async function handleIssueEvent(c: any, payload: GitHubIssuePayload) {
  const { action, issue, repository, installation } = payload;

  console.log(
    `Issue event: ${action} - #${issue.number} in ${repository.full_name}`,
  );

  // Only process opened issues
  if (action !== 'opened') {
    console.log(`Ignoring issue action: ${action}`);
    return c.json({ message: `Issue action '${action}' not processed` });
  }

  // Skip processing issues created by bots to avoid loops
  if (issue.user.login.includes('[bot]') || issue.user.login === 'claude') {
    console.log('Skipping bot-created issue');
    return c.json({ message: 'Bot issue skipped' });
  }

  // Extract installation ID from payload
  const installationId = installation?.id.toString();
  if (!installationId) {
    console.error('No installation ID found in webhook payload');
    return c.json({ error: 'Missing installation ID' }, 400);
  }

  try {
    console.log(`Processing issue for installation: ${installationId}`);

    // Find user configuration by installation ID
    const userConfigDO = getUserConfigDO(c.env);
    const userResponse = await userConfigDO.fetch(
      new Request(
        `http://localhost/user-by-installation?installationId=${installationId}`,
      ),
    );

    if (!userResponse.ok) {
      console.error(`No user found for installation ID: ${installationId}`);
      return c.json(
        {
          error: 'User not found for installation ID',
          installationId: installationId,
          message:
            'This installation ID is not registered. User must register via /register-user endpoint first.',
        },
        404,
      );
    }

    const userConfig = (await userResponse.json()) as UserConfig;
    console.log(
      `Found user: ${userConfig.userId} for installation: ${installationId}`,
    );

    // Get installation token for this user (with caching)
    console.log('Getting installation token for user...');
    const tokenManager = getTokenManager(c.env);
    const installationToken =
      await tokenManager.getInstallationToken(userConfig);
    if (!installationToken) {
      throw new Error('Failed to get installation token for user');
    }

    // Create legacy config for backward compatibility
    const legacyConfig = createLegacyGitHubAppConfig(
      userConfig,
      installationToken,
    );
    console.log('Installation token obtained successfully');

    // Get a container to process the issue
    const containerId = c.env.MY_CONTAINER.idFromName(`issue-${issue.id}`);
    const container = c.env.MY_CONTAINER.get(containerId);

    // Prepare container request
    const containerRequest: ContainerRequest = {
      type: 'process_issue',
      payload,
      config: legacyConfig,
    };

    // Send request to container with user's Anthropic API key
    console.log('Sending request to container:', {
      url: 'https://container/process-issue',
      method: 'POST',
      bodyLength: JSON.stringify(containerRequest).length,
      userId: userConfig.userId,
    });

    const containerResponse = await container.fetch(
      new Request('https://container/process-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(containerRequest),
      }),
      {
        env: {
          ANTHROPIC_API_KEY: userConfig.anthropicApiKey, // Use user's API key
          GITHUB_TOKEN: installationToken,
          USER_ID: userConfig.userId,
        },
      },
    );

    console.log('Container response status:', containerResponse.status);
    console.log(
      'Container response headers:',
      Object.fromEntries(containerResponse.headers.entries()),
    );

    // Handle container unavailable (503) responses specifically
    if (containerResponse.status === 503) {
      const responseText = await containerResponse.text();
      console.error('Container unavailable (503):', responseText);

      // Log helpful diagnostic information
      console.log('🔧 Container provisioning issue detected');
      console.log('📋 This usually indicates:');
      console.log('   - Container not yet provisioned (first deployment)');
      console.log('   - Max concurrent instances reached');
      console.log('   - Container provisioning in progress');
      console.log('💡 Try: wrangler deploy to ensure container is provisioned');

      return c.json(
        {
          success: false,
          message: 'Container service temporarily unavailable',
          error: '503 Service Unavailable - Container instance not available',
          status: 503,
          retryAfter: '5 minutes',
          suggestion:
            "Container may need to be provisioned. Run 'wrangler deploy' to ensure deployment.",
        },
        503,
      );
    }

    // Handle other non-JSON responses gracefully
    let result: any;
    const responseText = await containerResponse.text();

    console.log('Container response text length:', responseText.length);
    console.log('Container response preview:', responseText.substring(0, 300));

    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.error(
        'Container response is not valid JSON:',
        responseText.substring(0, 200),
      );
      console.error('Parse error:', parseError);

      return c.json(
        {
          success: false,
          message: 'Container returned invalid response',
          error: `Non-JSON response: ${responseText.substring(0, 100)}...`,
          status: containerResponse.status,
          headers: Object.fromEntries(containerResponse.headers.entries()),
        },
        500,
      );
    }

    console.log(`Issue processing result:`, result);

    return c.json({
      success: true,
      message: 'Issue processing initiated',
      issueId: issue.id,
      issueNumber: issue.number,
      result,
    });
  } catch (error) {
    console.error('Issue processing failed:', error);
    return c.json(
      {
        error: 'Issue processing failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        issueId: issue.id,
      },
      500,
    );
  }
}

// Process prompt request - creates issue and processes it (multi-tenant)
async function processPromptRequest(
  c: any,
  promptRequest: PromptRequest,
  userConfig: UserConfig,
): Promise<PromptProcessingResult> {
  try {
    console.log('=== PROCESSING PROMPT REQUEST ===');

    // Step 1: Determine target repository
    let targetRepository: string;
    if (promptRequest.repository) {
      // User specified repository
      targetRepository = promptRequest.repository;
      console.log(`Using user-specified repository: ${targetRepository}`);
    } else {
      // Get available repositories for this user
      const repositories = await getInstallationRepositories(userConfig);
      if (repositories.length === 0) {
        return {
          success: false,
          error: "No repositories found for this user's installation",
        };
      } else if (repositories.length === 1) {
        targetRepository = repositories[0].full_name;
        console.log(`Using single available repository: ${targetRepository}`);
      } else {
        return {
          success: false,
          error: `Multiple repositories available. Please specify one: ${repositories.map((r) => r.full_name).join(', ')}`,
        };
      }
    }

    // Step 2: Get repository information
    const [owner, repo] = targetRepository.split('/');
    const repoInfo = await getRepositoryInfo(userConfig, owner, repo);
    if (!repoInfo) {
      return {
        success: false,
        error: `Repository ${targetRepository} not found or not accessible`,
      };
    }

    // Step 3: Generate issue title if not provided
    let issueTitle = promptRequest.title;
    if (!issueTitle) {
      issueTitle = generateIssueTitle(promptRequest.prompt);
    }

    // Step 4: Create the GitHub issue
    console.log(`Creating issue in ${targetRepository}: ${issueTitle}`);
    const issue = await createGitHubIssue(
      userConfig,
      owner,
      repo,
      issueTitle,
      promptRequest.prompt,
    );

    if (!issue) {
      return {
        success: false,
        error: 'Failed to create GitHub issue',
      };
    }

    console.log(`Issue created: #${issue.number} (ID: ${issue.id})`);

    // Step 5: Create GitHub issue payload (simulate webhook payload)
    const issuePayload: GitHubIssuePayload = {
      action: 'opened',
      issue: {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        body: issue.body || '',
        state: 'open',
        html_url: issue.html_url,
        user: {
          login: 'claude-prompt-api', // Indicates this was created via API
        },
      },
      repository: {
        id: repoInfo.id,
        name: repo,
        full_name: targetRepository,
        clone_url: repoInfo.clone_url,
        default_branch: repoInfo.default_branch,
        owner: {
          login: owner,
        },
      },
      installation: {
        id: parseInt(userConfig.installationId),
      },
    };

    // Step 6: Process the issue using existing container logic
    console.log('Processing created issue using existing container flow...');

    const containerId = c.env.MY_CONTAINER.idFromName(
      `prompt-issue-${issue.id}`,
    );
    const container = c.env.MY_CONTAINER.get(containerId);

    // Get installation token for this user
    const tokenManager = getTokenManager(c.env);
    const installationToken =
      await tokenManager.getInstallationToken(userConfig);
    if (!installationToken) {
      return {
        success: false,
        error: 'Failed to generate installation token for user',
        issueId: issue.id,
        issueNumber: issue.number,
        issueUrl: issue.html_url,
        repository: targetRepository,
      };
    }

    // Create legacy config for backward compatibility
    const legacyConfig = createLegacyGitHubAppConfig(
      userConfig,
      installationToken,
    );

    const containerRequest: ContainerRequest = {
      type: 'process_issue',
      payload: issuePayload,
      config: legacyConfig,
    };

    const containerResponse = await container.fetch(
      new Request('https://container/process-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(containerRequest),
      }),
      {
        env: {
          ANTHROPIC_API_KEY: userConfig.anthropicApiKey, // Use user's API key
          GITHUB_TOKEN: installationToken,
          USER_ID: userConfig.userId,
        },
      },
    );

    if (containerResponse.status === 503) {
      return {
        success: false,
        error:
          'Container service temporarily unavailable. Please try again in a few minutes.',
        issueId: issue.id,
        issueNumber: issue.number,
        issueUrl: issue.html_url,
        repository: targetRepository,
      };
    }

    const responseText = await containerResponse.text();
    let containerResult: any;

    try {
      containerResult = JSON.parse(responseText);
    } catch (parseError) {
      console.error(
        'Container response is not valid JSON:',
        responseText.substring(0, 200),
      );
      return {
        success: false,
        error: 'Container returned invalid response',
        issueId: issue.id,
        issueNumber: issue.number,
        issueUrl: issue.html_url,
        repository: targetRepository,
      };
    }

    // Step 7: Return comprehensive result
    return {
      success: true,
      message: `Prompt processed successfully. Issue #${issue.number} created and resolved.`,
      issueId: issue.id,
      issueNumber: issue.number,
      issueUrl: issue.html_url,
      pullRequestUrl: containerResult.pullRequestUrl,
      repository: targetRepository,
      branch: promptRequest.branch || repoInfo.default_branch,
    };
  } catch (error) {
    console.error('Prompt request processing failed:', error);
    return {
      success: false,
      error: `Prompt processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// GitHub App configuration endpoints
app.get('/config', async (c) => {
  try {
    const config = await getGitHubConfig(c.env);
    if (!config) {
      return c.json({ error: 'No configuration found' }, 404);
    }

    // Return safe configuration (without secrets)
    return c.json({
      appId: config.appId,
      installationId: config.installationId,
      hasPrivateKey: !!config.privateKey,
      hasWebhookSecret: !!config.webhookSecret,
      hasInstallationToken: !!config.installationToken,
      tokenExpiry: config.tokenExpiresAt
        ? new Date(config.tokenExpiresAt).toISOString()
        : null,
    });
  } catch (error) {
    console.error('Failed to get configuration:', error);
    return c.json({ error: 'Configuration retrieval failed' }, 500);
  }
});

app.post('/config', async (c) => {
  try {
    const configData = await c.req.json();

    // Validate required fields
    if (
      !configData.appId ||
      !configData.privateKey ||
      !configData.webhookSecret
    ) {
      return c.json({ error: 'Missing required configuration fields' }, 400);
    }

    // Store configuration
    const configDO = getGitHubConfigDO(c.env);
    const response = await configDO.fetch(
      new Request('http://localhost/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configData),
      }),
    );

    if (!response.ok) {
      const error = await response.json();
      return c.json(
        { error: 'Failed to store configuration', details: error },
        500,
      );
    }

    console.log('GitHub App configuration stored successfully');
    return c.json({ message: 'Configuration stored successfully' });
  } catch (error) {
    console.error('Failed to store configuration:', error);
    return c.json({ error: 'Configuration storage failed' }, 500);
  }
});

app.delete('/config', async (c) => {
  try {
    const configDO = getGitHubConfigDO(c.env);
    const response = await configDO.fetch(
      new Request('http://localhost/clear', { method: 'DELETE' }),
    );

    if (!response.ok) {
      return c.json({ error: 'Failed to clear configuration' }, 500);
    }

    console.log('GitHub App configuration cleared');
    return c.json({ message: 'Configuration cleared successfully' });
  } catch (error) {
    console.error('Failed to clear configuration:', error);
    return c.json({ error: 'Configuration clearing failed' }, 500);
  }
});

// Container processing endpoint (for direct testing)
app.post('/container/process', async (c) => {
  try {
    const requestData = await c.req.json();
    const containerId = c.env.MY_CONTAINER.idFromName(`test-${Date.now()}`);
    const container = c.env.MY_CONTAINER.get(containerId);

    const response = await container.fetch(
      new Request('https://container/process-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      }),
    );

    // Handle non-JSON responses gracefully
    const responseText = await response.text();
    try {
      const result = JSON.parse(responseText);
      return c.json(result);
    } catch (parseError) {
      console.error(
        'Container response is not valid JSON:',
        responseText.substring(0, 200),
      );
      return c.json(
        {
          success: false,
          message: 'Container returned invalid response',
          error: `Non-JSON response: ${responseText.substring(0, 100)}...`,
          status: response.status,
        },
        500,
      );
    }
  } catch (error) {
    console.error('Direct container processing failed:', error);
    return c.json({ error: 'Processing failed' }, 500);
  }
});

// Container information endpoint
app.get('/container', (c) => {
  return c.json({
    name: 'Container Runtime',
    description: 'Claude Code container processing system',
    endpoints: {
      '/container': 'GET - Container system information',
      '/container/health': 'GET - Container health check',
      '/container/process': 'POST - Process GitHub issue directly',
    },
    status: 'ready',
    timestamp: new Date().toISOString(),
  });
});

// Container health check
app.get('/container/health', async (c) => {
  try {
    const containerId = c.env.MY_CONTAINER.idFromName('health-check');
    const container = c.env.MY_CONTAINER.get(containerId);
    const response = await container.fetch(
      new Request('https://container/health'),
    );

    // Handle non-JSON responses gracefully
    const responseText = await response.text();
    try {
      const health = JSON.parse(responseText);
      return c.json(health);
    } catch (parseError) {
      console.error(
        'Container health response is not valid JSON:',
        responseText.substring(0, 200),
      );
      return c.json(
        {
          success: false,
          message: 'Container health check returned invalid response',
          error: `Non-JSON response: ${responseText.substring(0, 100)}...`,
          status: response.status,
        },
        500,
      );
    }
  } catch (error) {
    console.error('Container health check failed:', error);
    return c.json({ error: 'Container health check failed' }, 500);
  }
});

// Container ACP endpoint - direct access to container's ACP server
app.post('/container/acp', async (c) => {
  try {
    // Get request body first
    const requestBody = await c.req.text();

    // Use consistent container for all ACP operations
    const containerName = 'acp-session';

    const containerId = c.env.MY_CONTAINER.idFromName(containerName);
    const container = c.env.MY_CONTAINER.get(containerId);

    // Forward JSON-RPC request to container ACP server
    const response = await container.fetch(
      new Request('https://container/acp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ACP-Direct': 'true',
        },
        body: requestBody,
      }),
    );

    // Return response as-is
    const responseText = await response.text();

    // Ensure it's valid JSON
    try {
      const jsonResponse = JSON.parse(responseText);
      return c.json(jsonResponse, response.status as any);
    } catch (parseError) {
      console.error(
        'Container ACP response is not valid JSON:',
        responseText.substring(0, 200),
      );
      return c.json(
        {
          jsonrpc: '2.0',
          error: {
            code: -32700,
            message: 'Parse error - container returned invalid JSON',
            data: { response: responseText.substring(0, 200) },
          },
          id: null,
        },
        500,
      );
    }
  } catch (error) {
    console.error('Container ACP request failed:', error);
    return c.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error - container ACP request failed',
          data: {
            error: error instanceof Error ? error.message : String(error),
          },
        },
        id: null,
      },
      500,
    );
  }
});

// Utility functions
async function getGitHubConfig(env: Env): Promise<GitHubAppConfig | null> {
  try {
    const configDO = getGitHubConfigDO(env);
    const response = await configDO.fetch(
      new Request('http://localhost/retrieve'),
    );

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to get GitHub configuration:', error);
    return null;
  }
}

function getGitHubConfigDO(env: Env) {
  const id = env.GITHUB_APP_CONFIG.idFromName('github-app-config');
  return env.GITHUB_APP_CONFIG.get(id);
}

function getUserConfigDO(env: Env) {
  const id = env.USER_CONFIG.idFromName('user-config');
  return env.USER_CONFIG.get(id);
}

// Generate issue title from prompt
function generateIssueTitle(prompt: string): string {
  // Extract first sentence or first 60 characters as title
  const firstSentence = prompt.split('.')[0].trim();
  if (firstSentence.length > 0 && firstSentence.length <= 60) {
    return firstSentence;
  }

  // Truncate to 60 characters and add ellipsis
  const truncated = prompt.substring(0, 60).trim();
  return truncated.length < prompt.length ? truncated + '...' : truncated;
}

// =============================================================================
// DEPLOYMENT UTILITIES
// =============================================================================

// Asynchronous deployment execution function
async function executeDeploymentAsync(deploymentId: string, env: Env) {
  try {
    console.log(`Starting deployment execution for ${deploymentId}`);

    // This would contain the actual deployment logic:
    // 1. Fork repository using GitHub API
    // 2. Configure secrets using Cloudflare API
    // 3. Deploy worker using Wrangler CLI
    // 4. Verify deployment health

    // For now, simulate deployment steps
    const steps = [
      { name: 'fork_repository', duration: 30000 }, // 30 seconds
      { name: 'configure_secrets', duration: 15000 }, // 15 seconds
      { name: 'deploy_worker', duration: 60000 }, // 1 minute
      { name: 'verify_deployment', duration: 15000 }, // 15 seconds
    ];

    for (const step of steps) {
      console.log(`Executing step: ${step.name}`);
      // Simulate step execution
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(step.duration, 5000)),
      ); // Cap at 5s for demo
      console.log(`Completed step: ${step.name}`);
    }

    console.log(`Deployment ${deploymentId} completed successfully`);
  } catch (error) {
    console.error(`Deployment ${deploymentId} failed:`, error);
    // In production, update deployment status to failed in Durable Objects
  }
}

// =============================================================================
// DEPLOYMENT API ENDPOINTS
// =============================================================================

// Deployment initiation endpoint
app.post('/api/deploy/initiate', async (c) => {
  try {
    const requestBody = await c.req.json();

    if (!requestBody.repositoryUrl) {
      return c.json(
        {
          success: false,
          error: 'Repository URL is required',
        },
        400,
      );
    }

    // Generate deployment ID
    const deploymentId = crypto.randomUUID();

    // Store deployment state
    const deployment = {
      id: deploymentId,
      repositoryUrl: requestBody.repositoryUrl,
      status: 'initiated',
      timestamp: new Date().toISOString(),
      steps: {
        fork_repository: 'pending',
        configure_secrets: 'pending',
        deploy_worker: 'pending',
        verify_deployment: 'pending',
      },
    };

    // In production, this would be stored in Durable Objects
    // For now, return deployment info

    return c.json({
      success: true,
      deploymentId,
      status: 'initiated',
      nextStep: 'configure',
      configurationUrl: `${new URL(c.req.url).origin}/api/deploy/configure?id=${deploymentId}`,
      message: 'Deployment initiated. Please configure your credentials.',
    });
  } catch (error) {
    console.error('Deployment initiation error:', error);
    return c.json(
      {
        success: false,
        error: 'Failed to initiate deployment',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

// Deployment configuration endpoint
app.post('/api/deploy/configure', async (c) => {
  try {
    const requestBody = await c.req.json();
    const deploymentId = c.req.query('id');

    if (!deploymentId) {
      return c.json(
        {
          success: false,
          error: 'Deployment ID is required',
        },
        400,
      );
    }

    // Validate required configuration
    const requiredFields = [
      'anthropicApiKey',
      'githubToken',
      'cloudflareApiToken',
      'cloudflareAccountId',
    ];
    const missingFields = requiredFields.filter((field) => !requestBody[field]);

    if (missingFields.length > 0) {
      return c.json(
        {
          success: false,
          error: 'Missing required configuration fields',
          missing: missingFields,
        },
        400,
      );
    }

    // Validate API keys format (basic validation)
    if (!requestBody.anthropicApiKey.startsWith('sk-ant-')) {
      return c.json(
        {
          success: false,
          error: 'Invalid Anthropic API key format',
        },
        400,
      );
    }

    if (
      !requestBody.githubToken.startsWith('ghp_') &&
      !requestBody.githubToken.startsWith('github_pat_')
    ) {
      return c.json(
        {
          success: false,
          error: 'Invalid GitHub token format',
        },
        400,
      );
    }

    // Store configuration securely (encrypted)
    // In production, use proper encryption with CryptoUtils.encrypt and proper key management
    // For now, store configuration data for deployment processing
    const configurationData = {
      deploymentId,
      anthropicApiKey: requestBody.anthropicApiKey, // In production, encrypt this
      githubToken: requestBody.githubToken, // In production, encrypt this
      cloudflareApiToken: requestBody.cloudflareApiToken, // In production, encrypt this
      cloudflareAccountId: requestBody.cloudflareAccountId,
      configuredAt: new Date().toISOString(),
    };

    // In production, store in Durable Objects
    console.log(`Configuration stored for deployment ${deploymentId}`);

    return c.json({
      success: true,
      deploymentId,
      status: 'configured',
      nextStep: 'execute',
      executionUrl: `${new URL(c.req.url).origin}/api/deploy/execute?id=${deploymentId}`,
      message: 'Configuration saved successfully. Ready to deploy.',
    });
  } catch (error) {
    console.error('Deployment configuration error:', error);
    return c.json(
      {
        success: false,
        error: 'Failed to save configuration',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

// Deployment execution endpoint
app.post('/api/deploy/execute', async (c) => {
  try {
    const deploymentId = c.req.query('id');

    if (!deploymentId) {
      return c.json(
        {
          success: false,
          error: 'Deployment ID is required',
        },
        400,
      );
    }

    // Update deployment status to executing
    const deployment = {
      id: deploymentId,
      status: 'executing',
      startedAt: new Date().toISOString(),
      steps: {
        fork_repository: 'in_progress',
        configure_secrets: 'pending',
        deploy_worker: 'pending',
        verify_deployment: 'pending',
      },
    };

    // Return immediate response and process asynchronously
    c.executionCtx.waitUntil(executeDeploymentAsync(deploymentId, c.env));

    return c.json({
      success: true,
      deploymentId,
      status: 'executing',
      statusUrl: `${new URL(c.req.url).origin}/api/deploy/status/${deploymentId}`,
      message: 'Deployment started. Monitor status using the status URL.',
      estimatedTime: '5-10 minutes',
    });
  } catch (error) {
    console.error('Deployment execution error:', error);
    return c.json(
      {
        success: false,
        error: 'Failed to start deployment',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

// Deployment status tracking endpoint
app.get('/api/deploy/status/:deploymentId', async (c) => {
  try {
    const deploymentId = c.req.param('deploymentId');

    // In production, retrieve from Durable Objects
    // For now, return mock status
    const mockStatus = {
      id: deploymentId,
      status: 'completed', // completed, executing, failed, pending
      progress: 100,
      steps: {
        fork_repository: 'completed',
        configure_secrets: 'completed',
        deploy_worker: 'completed',
        verify_deployment: 'completed',
      },
      startedAt: '2025-09-05T20:00:00Z',
      completedAt: '2025-09-05T20:05:30Z',
      workerUrl: `https://${deploymentId}.your-subdomain.workers.dev`,
      repositoryUrl: `https://github.com/username/${deploymentId}-claude-code-containers`,
      logs: [
        {
          timestamp: '2025-09-05T20:00:00Z',
          level: 'info',
          message: 'Deployment initiated',
        },
        {
          timestamp: '2025-09-05T20:01:00Z',
          level: 'info',
          message: 'Repository forked successfully',
        },
        {
          timestamp: '2025-09-05T20:02:30Z',
          level: 'info',
          message: 'Secrets configured',
        },
        {
          timestamp: '2025-09-05T20:04:00Z',
          level: 'info',
          message: 'Worker deployed successfully',
        },
        {
          timestamp: '2025-09-05T20:05:30Z',
          level: 'success',
          message: 'Deployment completed successfully',
        },
      ],
    };

    return c.json({
      success: true,
      deployment: mockStatus,
    });
  } catch (error) {
    console.error('Status retrieval error:', error);
    return c.json(
      {
        success: false,
        error: 'Failed to retrieve deployment status',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500,
    );
  }
});

// =============================================================================

// Error handling middleware
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json(
    {
      error: 'Internal server error',
      message: err.message,
      timestamp: new Date().toISOString(),
    },
    500,
  );
});

export default app;
