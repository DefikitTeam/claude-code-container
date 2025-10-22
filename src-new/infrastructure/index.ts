/**
 * Infrastructure Layer
 * Implementations of Core interfaces for external concerns
 *
 * Structure:
 * - services/ - Service implementations
 * - durable-objects/ - Durable Object persistence
 * - repositories/ - Repository implementations
 * - adapters/ - External API wrappers
 * - external/ - Migrated code from old architecture
 */

export * from './services';
export * from './repositories';
export * from './adapters';

// Note: Durable Objects are exported separately in their location
// export * from './durable-objects';

/**
 * Dependency Injection Container Factory
 *
 * Usage in Phase 4 (API layer):
 *
 * import { buildInfrastructure } from 'src/infrastructure';
 * import { buildUseCases } from 'src/core/use-cases';
 *
 * export async function buildDependencies(env: Env) {
 *   // Create services
 *   const cryptoService = new CryptoServiceImpl();
 *   await cryptoService.initialize(env.ENCRYPTION_KEY);
 *
 *   const tokenService = new TokenServiceImpl(generateGitHubToken);
 *
 *   const githubService = new GitHubServiceImpl(
 *     tokenService,
 *     env.GITHUB_APP_ID,
 *     env.GITHUB_APP_PRIVATE_KEY
 *   );
 *
 *   const deploymentService = new DeploymentServiceImpl(
 *     env.CLOUDFLARE_API_KEY,
 *     env.CLOUDFLARE_ACCOUNT_ID
 *   );
 *
 *   // Create adapters
 *   const cloudflareAdapter = new CloudflareApiAdapter({
 *     accountId: env.CLOUDFLARE_ACCOUNT_ID,
 *     apiToken: env.CLOUDFLARE_API_TOKEN,
 *   });
 *
 *   // Create repositories
 *   const userRepository = env.USER_CONFIG;
 *   const deploymentRepository = new DeploymentRepositoryImpl();
 *
 *   // Wire dependencies
 *   return {
 *     services: {
 *       crypto: cryptoService,
 *       token: tokenService,
 *       github: githubService,
 *       deployment: deploymentService,
 *     },
 *     repositories: {
 *       user: userRepository,
 *       deployment: deploymentRepository,
 *     },
 *     adapters: {
 *       cloudflare: cloudflareAdapter,
 *       wrangler: new WranglerWrapper({ projectRoot: '.' }),
 *     },
 *   };
 * }
 */

/**
 * Export types for DI wiring
 */
export type {
  IGitHubService,
  ITokenService,
  ICryptoService,
  IContainerService,
  IDeploymentService,
} from '../core/interfaces/services';

export type { IUserRepository, IDeploymentRepository } from '../core/interfaces/repositories';
