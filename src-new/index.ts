import { Hono } from 'hono';
import { cors } from 'hono/cors';

// Middleware
import { attachRequestContext } from './api/middleware/validation.middleware';
import { registerErrorMiddleware } from './api/middleware/error.middleware';

// Routes
import { createHealthRoutes } from './api/routes/health.routes';
import { createUserRoutes } from './api/routes/user.routes';
import { createGitHubRoutes } from './api/routes/github.routes';
import { createContainerRoutes } from './api/routes/container.routes';
import { createDeploymentRoutes } from './api/routes/deployment.routes';
import { createInstallationRoutes } from './api/routes/installation.routes';

// Controllers
import { UserController } from './api/controllers/user.controller';
import { GitHubController } from './api/controllers/github.controller';
import { ContainerController } from './api/controllers/container.controller';
import { DeploymentController } from './api/controllers/deployment.controller';
import { InstallationController } from './api/controllers/installation.controller';

// Use Cases - User
import { RegisterUserUseCase } from './core/use-cases/user/register-user.use-case';
import { GetUserUseCase } from './core/use-cases/user/get-user.use-case';
import { UpdateUserUseCase } from './core/use-cases/user/update-user.use-case';
import { DeleteUserUseCase } from './core/use-cases/user/delete-user.use-case';

// Use Cases - GitHub
import { ProcessWebhookUseCase } from './core/use-cases/github/process-webhook.use-case';
import { FetchRepositoriesUseCase } from './core/use-cases/github/fetch-repositories.use-case';
import { FetchBranchesUseCase } from './core/use-cases/github/fetch-branches.use-case';
import { CreatePullRequestUseCase } from './core/use-cases/github/create-pull-request.use-case';

// Use Cases - Container
import { SpawnContainerUseCase } from './core/use-cases/container/spawn-container.use-case';
import { ProcessPromptUseCase } from './core/use-cases/container/process-prompt.use-case';
import { GetLogsUseCase } from './core/use-cases/container/get-logs.use-case';
import { TerminateContainerUseCase } from './core/use-cases/container/terminate-container.use-case';

// Use Cases - Deployment
import { DeployWorkerUseCase } from './core/use-cases/deployment/deploy-worker.use-case';
import { GetStatusUseCase } from './core/use-cases/deployment/get-status.use-case';
import { RollbackUseCase } from './core/use-cases/deployment/rollback.use-case';
import { ValidateConfigUseCase } from './core/use-cases/deployment/validate-config.use-case';

// Infrastructure (placeholder imports - will be implemented in Phase 3)
// import { InMemoryUserRepository } from './infrastructure/repositories/in-memory-user.repository';

export interface Env {
  // Cloudflare bindings
  USER_CONFIG_DO: DurableObjectNamespace;
  GITHUB_APP_CONFIG_DO: DurableObjectNamespace;
  CONTAINER_DO: DurableObjectNamespace;
  ACP_SESSION_DO: DurableObjectNamespace;
  
  // Environment variables
  ENCRYPTION_KEY: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  ANTHROPIC_API_KEY?: string;
}

/**
 * Setup Dependency Injection
 * Creates all use cases, services, and controllers
 */
function setupDI(env: Env) {
  // TODO: Replace with real implementations from infrastructure layer
  // For now, create mock services for wiring demonstration
  
  const mockUserRepository = {
    findById: async () => null,
    findByInstallationId: async () => null,
    save: async (user: any) => user,
    delete: async () => {},
  };

  const mockGitHubService = {
    validateInstallation: async () => true,
    fetchRepositories: async () => [],
    fetchBranches: async () => [],
    createPullRequest: async () => ({ id: 1, url: 'https://github.com/test/pr/1' }),
    createIssue: async () => ({ id: 1 }),
    addComment: async () => {},
  };

  const mockCryptoService = {
    encrypt: async (data: string) => ({ encryptedData: new Uint8Array(), iv: new Uint8Array() }),
    decrypt: async (data: any) => 'decrypted',
    hash: async (data: string) => 'hashed',
    verifyWebhookSignature: async () => true,
    initialize: () => {},
  };

  const mockContainerService = {
    spawn: async () => ({ containerId: 'container-123', status: 'running' }),
    execute: async () => ({ success: true, output: 'done' }),
    terminate: async () => ({ success: true }),
    getLogs: async () => ({ logs: [] }),
  };

  const mockDeploymentService = {
    deploy: async () => ({ success: true, deploymentId: 'deploy-123' }),
    getStatus: async () => ({ status: 'deployed' }),
    rollback: async () => ({ success: true }),
    validate: async () => ({ valid: true, errors: [] }),
  };

  const mockDeploymentRepository = {
    findById: async () => null,
    save: async (deployment: any) => deployment,
    delete: async () => {},
  };

  // User Use Cases
  const registerUserUseCase = new RegisterUserUseCase(
    mockUserRepository as any,
    mockGitHubService as any,
    mockCryptoService as any,
  );
  const getUserUseCase = new GetUserUseCase(mockUserRepository as any);
  const updateUserUseCase = new UpdateUserUseCase(
    mockUserRepository as any,
    mockCryptoService as any,
  );
  const deleteUserUseCase = new DeleteUserUseCase(mockUserRepository as any);

  // GitHub Use Cases
  const processWebhookUseCase = new ProcessWebhookUseCase(mockGitHubService as any);
  const fetchRepositoriesUseCase = new FetchRepositoriesUseCase(mockGitHubService as any);
  const fetchBranchesUseCase = new FetchBranchesUseCase(mockGitHubService as any);
  const createPullRequestUseCase = new CreatePullRequestUseCase(mockGitHubService as any);

  // Container Use Cases
  const spawnContainerUseCase = new SpawnContainerUseCase(
    mockContainerService as any,
  );
  const processPromptUseCase = new ProcessPromptUseCase(mockContainerService as any);
  const getLogsUseCase = new GetLogsUseCase(mockContainerService as any);
  const terminateContainerUseCase = new TerminateContainerUseCase(mockContainerService as any);

  // Deployment Use Cases
  const deployWorkerUseCase = new DeployWorkerUseCase(
    mockDeploymentRepository as any,
    mockDeploymentService as any,
  );
  const getStatusUseCase = new GetStatusUseCase(mockDeploymentRepository as any);
  const rollbackUseCase = new RollbackUseCase(
    mockDeploymentRepository as any,
    mockDeploymentService as any,
  );
  const validateConfigUseCase = new ValidateConfigUseCase(mockDeploymentService as any);

  // Controllers
  const userController = new UserController(
    registerUserUseCase,
    getUserUseCase,
    updateUserUseCase,
    deleteUserUseCase,
  );

  const githubController = new GitHubController(
    processWebhookUseCase,
    fetchRepositoriesUseCase,
    fetchBranchesUseCase,
    createPullRequestUseCase,
  );

  const containerController = new ContainerController(
    spawnContainerUseCase,
    processPromptUseCase,
    getLogsUseCase,
    terminateContainerUseCase,
  );

  const deploymentController = new DeploymentController(
    deployWorkerUseCase,
    getStatusUseCase,
    rollbackUseCase,
    validateConfigUseCase,
  );

  const installationController = new InstallationController();

  return {
    userController,
    githubController,
    containerController,
    deploymentController,
    installationController,
  };
}

/**
 * Create Hono App with all routes and middleware
 */
function createApp(env: Env) {
  const app = new Hono<{ Bindings: Env }>();

  // Global middleware
  app.use('*', attachRequestContext());
  app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Installation-ID', 'X-User-ID'],
    maxAge: 86400,
    credentials: true,
  }));

  // Error handling
  registerErrorMiddleware(app as any);

  // Setup DI - create all controllers once
  const controllers = setupDI(env);

  // Health routes (no DI needed)
  app.route('/health', createHealthRoutes());

  // Mount API routes with controllers
  app.route('/api/users', createUserRoutes(controllers.userController));
  app.route('/api/github', createGitHubRoutes(controllers.githubController));
  app.route('/api/containers', createContainerRoutes(controllers.containerController));
  app.route('/api/deployments', createDeploymentRoutes(controllers.deploymentController));
  app.route('/api/installations', createInstallationRoutes(controllers.installationController));

  // 404 handler
  app.notFound((c) => {
    return c.json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
      },
      timestamp: Date.now(),
    }, 404);
  });

  return app;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const app = createApp(env);
    return await app.fetch(request, env, ctx);
  },
};
