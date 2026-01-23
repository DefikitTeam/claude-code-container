import { Context } from 'hono';
import { successResponse } from '../responses/success.response';
import { errorResponse } from '../responses/error.response';

export class InstallationController {
  async getInstallation(c: Context) {
    try {
      const installationId = c.req.header('x-installation-id');

      if (!installationId) {
        return errorResponse(c, new Error('Installation ID is required'));
      }

      // Placeholder - implement installation lookup via use case
      const installation = {
        installationId,
        status: 'active',
        createdAt: Date.now(),
      };

      return successResponse(c, installation, 200);
    } catch (err: unknown) {
      return errorResponse(c, err);
    }
  }

  async updateInstallation(c: Context) {
    try {
      const installationId = c.req.header('x-installation-id');
      const body = await c.req.json();

      if (!installationId) {
        return errorResponse(c, new Error('Installation ID is required'));
      }

      // Placeholder - implement installation update via use case
      const installation = {
        installationId,
        ...body,
        updatedAt: Date.now(),
      };

      return successResponse(c, installation, 200);
    } catch (err: unknown) {
      return errorResponse(c, err);
    }
  }
}
