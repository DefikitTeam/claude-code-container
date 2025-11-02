/**
 * ACP Controller
 * Handles Agent Communication Protocol (ACP) requests
 */

import { Context } from 'hono';
import { IACPBridgeService } from '../../infrastructure/services/acp-bridge.service';
import { successResponse } from '../responses/success.response';
import { errorResponse } from '../responses/error.response';

export class ACPController {
  constructor(private readonly acpBridgeService: IACPBridgeService) {}

  /**
   * Initialize - ACP initialization handshake
   * Returns JSON-RPC 2.0 response
   */
  async initialize(c: Context) {
    try {
      const params = await c.req.json();
      const result = await this.acpBridgeService.routeACPMethod('initialize', params, c.env);
      return c.json(result);
    } catch (err: any) {
      return errorResponse(c, err);
    }
  }

  /**
   * Session New - Create new ACP session
   * Returns JSON-RPC 2.0 response
   */
  async sessionNew(c: Context) {
    try {
      const params = await c.req.json();
      const result = await this.acpBridgeService.routeACPMethod('session/new', params, c.env);
      return c.json(result);
    } catch (err: any) {
      return errorResponse(c, err);
    }
  }

  /**
   * Session Prompt - Send prompt to existing session
   * Returns JSON-RPC 2.0 response
   */
  async sessionPrompt(c: Context) {
    try {
      const params = await c.req.json();
      const result = await this.acpBridgeService.routeACPMethod('session/prompt', params, c.env);
      return c.json(result);
    } catch (err: any) {
      return errorResponse(c, err);
    }
  }

  /**
   * Session Load - Load existing session state
   * Returns JSON-RPC 2.0 response
   */
  async sessionLoad(c: Context) {
    try {
      const params = await c.req.json();
      const result = await this.acpBridgeService.routeACPMethod('session/load', params, c.env);
      return c.json(result);
    } catch (err: any) {
      return errorResponse(c, err);
    }
  }

  /**
   * Cancel - Cancel ongoing ACP operation
   * Returns JSON-RPC 2.0 response
   */
  async cancel(c: Context) {
    try {
      const params = await c.req.json();
      const result = await this.acpBridgeService.routeACPMethod('cancel', params, c.env);
      return c.json(result);
    } catch (err: any) {
      return errorResponse(c, err);
    }
  }

  /**
   * Generic ACP method handler (catch-all)
   */
  async handleMethod(c: Context) {
    try {
      const method = c.req.param('method');
      const body = await c.req.json();
      const result = await this.acpBridgeService.routeACPMethod(method, body, c.env);
      return c.json(result);
    } catch (err: any) {
      return errorResponse(c, err);
    }
  }

  /**
   * Legacy task execute endpoint (backward compatibility)
   */
  async taskExecute(c: Context) {
    try {
      const msg = await c.req.json();
      const payload = msg.params || msg.payload;

      // If the payload is a GitHub issue payload, forward to the container processing flow
      if (payload && payload.issue && payload.repository) {
        const issue = payload;
        const containerId = c.env.MY_CONTAINER.idFromName(`acp-issue-${issue.issue.id}`);
        const container = c.env.MY_CONTAINER.get(containerId);

        const containerRequest = {
          type: 'process_issue',
          payload,
          config: {
            appId: c.env.FIXED_GITHUB_APP_ID || '',
            privateKey: '',
            webhookSecret: '',
          },
        };

        const resp = await container.fetch(
          new Request('https://container/process-issue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(containerRequest),
          }),
        );

        const text = await resp.text();
        let parsed: any = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { raw: text };
        }

        return c.json({
          success: true,
          forwarded: true,
          status: resp.status,
          result: parsed,
        });
      }

      // Otherwise queue for processing
      return c.json({ success: true, queued: true });
    } catch (err: any) {
      return errorResponse(c, err);
    }
  }

  /**
   * Get ACP status
   */
  async getStatus(c: Context) {
    try {
      const status = await this.acpBridgeService.getStatus(c.env);
      return successResponse(c, status, 200);
    } catch (err: any) {
      return errorResponse(c, err);
    }
  }
}
