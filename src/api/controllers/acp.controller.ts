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
      const jsonRpcRequest = await c.req.json();
      // Extract params from JSON-RPC envelope (params field contains actual parameters)
      const params = jsonRpcRequest.params || jsonRpcRequest;
      // Allow the worker to be requested to stream via query param: ?stream=true
      if (c.req.query('stream') === 'true') {
        params.stream = true;
      }
      const result = await this.acpBridgeService.routeACPMethod(
        'initialize',
        params,
        c.env,
      );
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
      const jsonRpcRequest = await c.req.json();
      // Extract params from JSON-RPC envelope (params field contains actual parameters)
      const params = jsonRpcRequest.params || jsonRpcRequest;
      if (c.req.query('stream') === 'true') {
        params.stream = true;
      }
      const result = await this.acpBridgeService.routeACPMethod(
        'session/new',
        params,
        c.env,
      );
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
    const startTime = Date.now();
    try {
      console.log('[ACP-CONTROLLER] sessionPrompt - START');
      const jsonRpcRequest = await c.req.json();
      console.log(
        '[ACP-CONTROLLER] Received JSON-RPC request, id:',
        jsonRpcRequest.id,
      );

      // Extract params from JSON-RPC envelope (params field contains actual parameters)
      const params = jsonRpcRequest.params || jsonRpcRequest;

      // Check if async mode is requested
      const isAsync = params.async === true || c.req.query('async') === 'true';

      if (isAsync) {
        console.log('[ACP-CONTROLLER] Using ASYNC mode');
        // Async mode - return immediately with jobId
        const result = await this.acpBridgeService.routeACPMethodAsync(
          'session/prompt',
          params,
          c.env,
        );
        return c.json({
          jsonrpc: '2.0',
          result: {
            jobId: result.jobId,
            status: result.status,
            message: 'Job created. Poll /acp/job/:jobId for results.',
          },
          id: jsonRpcRequest.id || Date.now(),
        });
      }

      console.log('[ACP-CONTROLLER] Using SYNC mode');
      // Sync mode - wait for completion (original behavior)
      const result = await this.acpBridgeService.routeACPMethod(
        'session/prompt',
        params,
        c.env,
      );

      console.log('[ACP-CONTROLLER] Got result from bridge service');
      console.log('[ACP-CONTROLLER] Result keys:', Object.keys(result || {}));
      console.log('[ACP-CONTROLLER] Result has error:', !!result?.error);
      console.log('[ACP-CONTROLLER] Result has result:', !!result?.result);

      // Serialize to JSON string first to ensure it's valid
      const jsonString = JSON.stringify(result);
      console.log(
        '[ACP-CONTROLLER] JSON serialized, length:',
        jsonString.length,
      );

      const duration = Date.now() - startTime;
      console.log(`[ACP-CONTROLLER] sessionPrompt - END (${duration}ms)`);
      console.log('[ACP-CONTROLLER] About to return response to client');

      // Return with explicit headers to ensure proper streaming
      // return new Response(jsonString, {
      //   status: 200,
      //   headers: {
      //     'Content-Type': 'application/json',
      //     'Content-Length': jsonString.length.toString(),
      //   },
      // });
      return c.json(result);
    } catch (err: any) {
      const duration = Date.now() - startTime;
      console.error(
        `[ACP-CONTROLLER] sessionPrompt - ERROR after ${duration}ms:`,
        err.message,
      );
      return errorResponse(c, err);
    }
  }

  /**
   * Get async job status
   */
  async getJobStatus(c: Context) {
    try {
      const jobId = c.req.param('jobId');
      if (!jobId) {
        return c.json(
          {
            jsonrpc: '2.0',
            error: {
              code: -32602,
              message: 'Invalid params: jobId is required',
            },
            id: Date.now(),
          },
          400,
        );
      }

      const result = await this.acpBridgeService.getAsyncJobStatus(
        jobId,
        c.env,
      );

      if (result.error) {
        return c.json(
          {
            jsonrpc: '2.0',
            error: {
              code: result.code === 'JOB_NOT_FOUND' ? -32001 : -32603,
              message: result.error,
            },
            id: Date.now(),
          },
          result.code === 'JOB_NOT_FOUND' ? 404 : 500,
        );
      }

      return c.json({
        jsonrpc: '2.0',
        result,
        id: Date.now(),
      });
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
      const jsonRpcRequest = await c.req.json();
      // Extract params from JSON-RPC envelope (params field contains actual parameters)
      const params = jsonRpcRequest.params || jsonRpcRequest;
      const result = await this.acpBridgeService.routeACPMethod(
        'session/load',
        params,
        c.env,
      );
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
      const jsonRpcRequest = await c.req.json();
      // Extract params from JSON-RPC envelope (params field contains actual parameters)
      const params = jsonRpcRequest.params || jsonRpcRequest;
      const result = await this.acpBridgeService.routeACPMethod(
        'cancel',
        params,
        c.env,
      );
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
      const jsonRpcRequest = await c.req.json();
      // Extract params from JSON-RPC envelope (params field contains actual parameters)
      const params = jsonRpcRequest.params || jsonRpcRequest;
      const result = await this.acpBridgeService.routeACPMethod(
        method,
        params,
        c.env,
      );
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
        const containerId = c.env.MY_CONTAINER.idFromName(
          `acp-issue-${issue.issue.id}`,
        );
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
