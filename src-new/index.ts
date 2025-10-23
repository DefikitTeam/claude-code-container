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

// Infrastructure - Real Phase 3 Implementations
import { UserConfigDO } from './infrastructure/durable-objects/user-config.do';
import { GitHubServiceImpl } from './infrastructure/services/github.service.impl';
import { CryptoServiceImpl } from './infrastructure/services/crypto.service.impl';
import { TokenServiceImpl } from './infrastructure/services/token.service.impl';
import { DeploymentServiceImpl } from './infrastructure/services/deployment.service.impl';

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
 * Creates all use cases, services, and controllers using REAL Phase 3 implementations
 */
function setupDI(env: Env) {
  // ============================================
  // Phase 3 Infrastructure - Real Services
  // ============================================
  
  // 1. Crypto Service
  const cryptoService = new CryptoServiceImpl();
  // Initialize with encryption key from environment
  cryptoService.initialize(env.ENCRYPTION_KEY);
  
  // 2. Token Service (no constructor params needed - uses internal generator)
  const tokenService = new TokenServiceImpl();
  
  // 3. GitHub Service (depends on Token Service + App credentials)
  const githubService = new GitHubServiceImpl(
    tokenService,
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY
  );
  
  // 4. Deployment Service
  const deploymentService = new DeploymentServiceImpl();
  
  // 5. User Repository - Use Durable Object as repository
  // Note: In real runtime, this should be accessed via DO stub
  // For now, we'll create a wrapper that uses the DO namespace
  const userRepository = {
    findById: async (userId: string) => {
      const id = env.USER_CONFIG_DO.idFromName(userId);
      const stub = env.USER_CONFIG_DO.get(id);
      return await (stub as any).findById(userId);
    },
    findByInstallationId: async (installationId: string) => {
      // Use installation ID as namespace for DO lookup
      const id = env.USER_CONFIG_DO.idFromName(`installation:${installationId}`);
      const stub = env.USER_CONFIG_DO.get(id);
      return await (stub as any).findByInstallationId(installationId);
    },
    save: async (user: any) => {
      const id = env.USER_CONFIG_DO.idFromName(user.userId);
      const stub = env.USER_CONFIG_DO.get(id);
      return await (stub as any).save(user);
    },
    delete: async (userId: string) => {
      const id = env.USER_CONFIG_DO.idFromName(userId);
      const stub = env.USER_CONFIG_DO.get(id);
      await (stub as any).delete(userId);
    },
  };
  
  // 6. Container Service - Wraps Container DO
  const containerService = {
    spawn: async (params: any) => {
      const id = env.CONTAINER_DO.idFromName(params.containerId || `container-${Date.now()}`);
      const stub = env.CONTAINER_DO.get(id);
      return await (stub as any).spawn(params);
    },
    execute: async (containerId: string, command: any) => {
      const id = env.CONTAINER_DO.idFromName(containerId);
      const stub = env.CONTAINER_DO.get(id);
      return await (stub as any).execute(command);
    },
    terminate: async (containerId: string) => {
      const id = env.CONTAINER_DO.idFromName(containerId);
      const stub = env.CONTAINER_DO.get(id);
      return await (stub as any).terminate();
    },
    getLogs: async (containerId: string) => {
      const id = env.CONTAINER_DO.idFromName(containerId);
      const stub = env.CONTAINER_DO.get(id);
      return await (stub as any).getLogs();
    },
  };
  
  // 7. Deployment Repository - Wraps DO (if needed) or use in-memory
  // For now, use a simple in-memory implementation
  const deploymentRepository = {
    findById: async (id: string) => null,
    save: async (deployment: any) => deployment,
    delete: async (id: string) => {},
  };

  // ============================================
  // Use Cases - Inject Real Services
  // ============================================
  
  // User Use Cases
  const registerUserUseCase = new RegisterUserUseCase(
    userRepository as any,
    githubService as any,
    cryptoService as any,
  );
  const getUserUseCase = new GetUserUseCase(userRepository as any);
  const updateUserUseCase = new UpdateUserUseCase(
    userRepository as any,
    cryptoService as any,
  );
  const deleteUserUseCase = new DeleteUserUseCase(userRepository as any);

  // GitHub Use Cases
  const processWebhookUseCase = new ProcessWebhookUseCase(githubService as any);
  const fetchRepositoriesUseCase = new FetchRepositoriesUseCase(githubService as any);
  const fetchBranchesUseCase = new FetchBranchesUseCase(githubService as any);
  const createPullRequestUseCase = new CreatePullRequestUseCase(githubService as any);

  // Container Use Cases
  const spawnContainerUseCase = new SpawnContainerUseCase(
    containerService as any,
  );
  const processPromptUseCase = new ProcessPromptUseCase(containerService as any);
  const getLogsUseCase = new GetLogsUseCase(containerService as any);
  const terminateContainerUseCase = new TerminateContainerUseCase(containerService as any);

  // Deployment Use Cases
  const deployWorkerUseCase = new DeployWorkerUseCase(
    deploymentRepository as any,
    deploymentService as any,
  );
  const getStatusUseCase = new GetStatusUseCase(deploymentRepository as any);
  const rollbackUseCase = new RollbackUseCase(
    deploymentRepository as any,
    deploymentService as any,
  );
  const validateConfigUseCase = new ValidateConfigUseCase(deploymentService as any);

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
