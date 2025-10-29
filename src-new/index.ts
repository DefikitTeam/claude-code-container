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
import { createACPRoutes } from './api/routes/acp.routes';

// Controllers
import { UserController } from './api/controllers/user.controller';
import { GitHubController } from './api/controllers/github.controller';
import { ContainerController } from './api/controllers/container.controller';
import { DeploymentController } from './api/controllers/deployment.controller';
import { InstallationController } from './api/controllers/installation.controller';
import { ACPController } from './api/controllers/acp.controller';

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
import { GitHubServiceImpl } from './infrastructure/services/github.service.impl';
import { CryptoServiceImpl } from './infrastructure/services/crypto.service.impl';
import { TokenServiceImpl } from './infrastructure/services/token.service.impl';
import { DeploymentServiceImpl } from './infrastructure/services/deployment.service.impl';
import { ContainerServiceImpl } from './infrastructure/services/container.service.impl';
import { ACPBridgeService } from './infrastructure/services/acp-bridge.service';
import { ContainerRegistryAuthService } from './infrastructure/services/container-registry-auth.service';
import { DeploymentRepositoryImpl } from './infrastructure/repositories/deployment-repository.impl';
import { UserRepositoryDurableObjectAdapter } from './infrastructure/adapters/user-repository.do-adapter';

// Utilities
import { generateGitHubInstallationToken } from './shared/utils/github-token.util';

// Durable Objects
import {
  ContainerDO,
  GitHubAppConfigDO,
  UserConfigDO,
  AcpSessionDO,
} from './infrastructure/durable-objects';

export interface Env {
  // Cloudflare bindings (must match wrangler.jsonc binding names)
  USER_CONFIG: DurableObjectNamespace;
  GITHUB_APP_CONFIG: DurableObjectNamespace;
  MY_CONTAINER: DurableObjectNamespace;
  ACP_SESSION: DurableObjectNamespace;
  
  // Environment variables
  ENCRYPTION_KEY: string;
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  ANTHROPIC_API_KEY?: string;
}

/**
 * Controller bundle cached after DI initialization
 */
interface Controllers {
  userController: UserController;
  githubController: GitHubController;
  containerController: ContainerController;
  deploymentController: DeploymentController;
  installationController: InstallationController;
  acpController: ACPController;
}

let cachedControllers: Controllers | null = null;
let cachedApp: Hono<{ Bindings: Env }> | null = null;

/**
 * Setup Dependency Injection
 * Creates all use cases, services, and controllers using REAL implementations
 */
async function setupDI(env: Env): Promise<Controllers> {
  if (cachedControllers) {
    return cachedControllers;
  }

  const cryptoService = new CryptoServiceImpl();
  await cryptoService.initialize(env.ENCRYPTION_KEY);

  // Real GitHub token generator using JWT + Installation Token flow
  const tokenService = new TokenServiceImpl(async (installationId: string) => {
    return await generateGitHubInstallationToken(
      installationId,
      env.GITHUB_APP_ID,
      env.GITHUB_APP_PRIVATE_KEY,
    );
  });

  const githubService = new GitHubServiceImpl(
    tokenService,
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY,
  );

  const deploymentService = new DeploymentServiceImpl();
  const userRepository = new UserRepositoryDurableObjectAdapter(env.USER_CONFIG);
  const containerService = new ContainerServiceImpl(env.MY_CONTAINER);
  const deploymentRepository = new DeploymentRepositoryImpl();
  
  // Initialize ACP Bridge and Container Registry Auth services
  const acpBridgeService = new ACPBridgeService(tokenService, githubService);
  const containerRegistryAuthService = new ContainerRegistryAuthService(env, tokenService);

  const registerUserUseCase = new RegisterUserUseCase(userRepository, githubService, cryptoService);
  const getUserUseCase = new GetUserUseCase(userRepository);
  const updateUserUseCase = new UpdateUserUseCase(userRepository, cryptoService);
  const deleteUserUseCase = new DeleteUserUseCase(userRepository);

  const processWebhookUseCase = new ProcessWebhookUseCase(githubService);
  const fetchRepositoriesUseCase = new FetchRepositoriesUseCase(githubService);
  const fetchBranchesUseCase = new FetchBranchesUseCase(githubService);
  const createPullRequestUseCase = new CreatePullRequestUseCase(githubService);

  const spawnContainerUseCase = new SpawnContainerUseCase(containerService);
  const processPromptUseCase = new ProcessPromptUseCase(containerService);
  const getLogsUseCase = new GetLogsUseCase(containerService);
  const terminateContainerUseCase = new TerminateContainerUseCase(containerService);

  const deployWorkerUseCase = new DeployWorkerUseCase(deploymentRepository, deploymentService);
  const getStatusUseCase = new GetStatusUseCase(deploymentRepository);
  const rollbackUseCase = new RollbackUseCase(deploymentRepository, deploymentService);
  const validateConfigUseCase = new ValidateConfigUseCase(deploymentService);

  cachedControllers = {
    userController: new UserController(
      registerUserUseCase,
      getUserUseCase,
      updateUserUseCase,
      deleteUserUseCase,
    ),
    githubController: new GitHubController(
      processWebhookUseCase,
      fetchRepositoriesUseCase,
      fetchBranchesUseCase,
      createPullRequestUseCase,
    ),
    containerController: new ContainerController(
      spawnContainerUseCase,
      processPromptUseCase,
      getLogsUseCase,
      terminateContainerUseCase,
    ),
    deploymentController: new DeploymentController(
      deployWorkerUseCase,
      getStatusUseCase,
      rollbackUseCase,
      validateConfigUseCase,
    ),
    installationController: new InstallationController(),
    acpController: new ACPController(acpBridgeService),
  };

  return cachedControllers;
}

/**
 * Create Hono App with all routes and middleware
 */
async function ensureApp(env: Env): Promise<Hono<{ Bindings: Env }>> {
  if (cachedApp) {
    return cachedApp;
  }

  const controllers = await setupDI(env);

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

  registerErrorMiddleware(app as unknown as Hono);

  app.route('/health', createHealthRoutes());
  app.route('/api/users', createUserRoutes(controllers.userController));
  app.route('/api/github', createGitHubRoutes(controllers.githubController));
  app.route('/api/containers', createContainerRoutes(controllers.containerController));
  app.route('/api/deployments', createDeploymentRoutes(controllers.deploymentController));
  app.route('/api/installations', createInstallationRoutes(controllers.installationController));
  app.route('/acp', createACPRoutes(controllers.acpController));

  app.notFound((c) => c.json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found',
    },
    timestamp: Date.now(),
  }, 404));

  cachedApp = app;
  return app;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const app = await ensureApp(env);
    return app.fetch(request, env, ctx);
  },
};

// Export Durable Objects for Wrangler binding discovery
export {
  ContainerDO as MyContainer,
  GitHubAppConfigDO,
  UserConfigDO,
  AcpSessionDO as ACPSessionDO,
};
