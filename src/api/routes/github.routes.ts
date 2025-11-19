import { Hono } from 'hono';
import { GitHubController } from '../controllers/github.controller';
import {
  requireInstallationHeaders,
  requireJsonBody,
} from '../middleware/validation.middleware';

export function createGitHubRoutes(controller: GitHubController): Hono {
  const router = new Hono();

  // POST /webhooks - Process GitHub webhook
  router.post(
    '/webhooks',
    requireInstallationHeaders(),
    requireJsonBody(),
    (c) => controller.processWebhook(c),
  );

  // GET /repositories - Fetch repositories for installation
  router.get('/repositories', requireInstallationHeaders(), (c) =>
    controller.fetchRepositories(c),
  );

  // GET /repositories/:repository/branches - Fetch branches
  router.get(
    '/repositories/:repository/branches',
    requireInstallationHeaders(),
    (c) => controller.fetchBranches(c),
  );

  // POST /pull-requests - Create pull request
  router.post(
    '/pull-requests',
    requireInstallationHeaders(),
    requireJsonBody(),
    (c) => controller.createPullRequest(c),
  );

  return router;
}
