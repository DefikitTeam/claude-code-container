import { Hono } from "hono";
import type { Env, ACPMessage, ACPSession, GitHubIssuePayload, ContainerRequest } from "./types";

// Enhanced ACP bridge that routes all ACP methods to container's enhanced handlers
// This implements the production flow: Worker (8787) → Container (8080) → Enhanced ACP Handlers
const sessions: Map<string, ACPSession> = new Map();

export function addACPEndpoints(app: Hono<{ Bindings: Env }>) {

  // Generic ACP method router - routes all ACP methods to container
  const acpMethodRouter = async (c: any, method: string, params: any) => {
    try {
      console.log(`[ACP-BRIDGE] Routing method: ${method}`);

      // Get container instance for ACP processing (use same ID as working health check)
      const containerId = c.env.MY_CONTAINER.idFromName("health-check");
      const container = c.env.MY_CONTAINER.get(containerId);

      // Create JSON-RPC request for container ACP server
      const jsonRpcRequest = {
        jsonrpc: "2.0",
        method: method,
        params: params,
        id: Date.now()
      };

      console.log(`[ACP-BRIDGE] Sending to container:`, {
        method,
        paramsKeys: Object.keys(params || {}),
        containerId: containerId.toString()
      });

      // Route to container ACP server via HTTP
      const containerResponse = await container.fetch(
        new Request("https://container/acp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-ACP-Bridge": "true"
          },
          body: JSON.stringify(jsonRpcRequest)
        }),
        {
          env: {
            ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY,
            NODE_ENV: "production"
          }
        }
      );

      console.log(`[ACP-BRIDGE] Container response status:`, containerResponse.status);

      if (!containerResponse.ok) {
        const errorText = await containerResponse.text();
        console.error(`[ACP-BRIDGE] Container error:`, errorText);
        return c.json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Container processing failed",
            data: { status: containerResponse.status, error: errorText }
          },
          id: jsonRpcRequest.id
        }, containerResponse.status);
      }

      // Parse container response
      const responseText = await containerResponse.text();
      console.log(`[ACP-BRIDGE] Container response length:`, responseText.length);

      let containerResult;
      try {
        containerResult = JSON.parse(responseText);
      } catch (parseError) {
        console.error(`[ACP-BRIDGE] Invalid JSON response:`, responseText.substring(0, 200));
        return c.json({
          jsonrpc: "2.0",
          error: {
            code: -32700,
            message: "Parse error - container returned invalid JSON",
            data: { response: responseText.substring(0, 200) }
          },
          id: jsonRpcRequest.id
        }, 500);
      }

      console.log(`[ACP-BRIDGE] Successfully routed ${method} to container`);
      return c.json(containerResult);

    } catch (error) {
      console.error(`[ACP-BRIDGE] Router error for ${method}:`, error);
      return c.json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal error in ACP bridge",
          data: { error: error instanceof Error ? error.message : String(error) }
        },
        id: Date.now()
      }, 500);
    }
  };

  // ACP v0.3.1 method endpoints - all route to enhanced container handlers

  // Initialize method
  app.post('/acp/initialize', async (c) => {
    const body = await c.req.json();
    return await acpMethodRouter(c, 'initialize', body);
  });

  // Session management methods
  app.post('/acp/session/new', async (c) => {
    const body = await c.req.json();
    return await acpMethodRouter(c, 'session/new', body);
  });

  app.post('/acp/session/prompt', async (c) => {
    const body = await c.req.json();
    return await acpMethodRouter(c, 'session/prompt', body);
  });

  app.post('/acp/session/load', async (c) => {
    const body = await c.req.json();
    return await acpMethodRouter(c, 'session/load', body);
  });

  // Cancel method
  app.post('/acp/cancel', async (c) => {
    const body = await c.req.json();
    return await acpMethodRouter(c, 'cancel', body);
  });

  // Generic ACP method handler (catch-all for any other ACP methods)
  app.post('/acp/:method', async (c) => {
    const method = c.req.param('method');
    const body = await c.req.json();
    return await acpMethodRouter(c, method, body);
  });

  // Backward compatibility - legacy task execute endpoint
  app.post('/acp/task/execute', async (c) => {
    const msg = await c.req.json() as ACPMessage;
    const payload = (msg as any).params || (msg as any).payload;

    // If the payload is a GitHub issue payload, forward to the container processing flow
    if (payload && payload.issue && payload.repository) {
      try {
        const issue = payload as GitHubIssuePayload;
        const containerId = c.env.MY_CONTAINER.idFromName(`acp-issue-${issue.issue.id}`);
        const container = c.env.MY_CONTAINER.get(containerId);

        const containerRequest: ContainerRequest = {
          type: 'process_issue',
          payload,
          config: {
            appId: c.env.FIXED_GITHUB_APP_ID || '',
            privateKey: '',
            webhookSecret: ''
          }
        };

        const resp = await container.fetch(
          new Request('https://container/process-issue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(containerRequest)
          })
        );

        const text = await resp.text();
        let parsed: any = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { raw: text };
        }

        return c.json({ success: true, forwarded: true, status: resp.status, result: parsed });
      } catch (err) {
        return c.json({ success: false, error: (err as Error).message || String(err) }, 500);
      }
    }

    // Legacy session tracking
    const target = (msg as any).target;
    if (target && sessions.has(target)) {
      const s = sessions.get(target)!;
      s.lastSeenAt = Date.now();
      return c.json({ success: true, deliveredTo: s.sessionId });
    }

    return c.json({ success: true, queued: true });
  });

  // Status and health endpoints
  app.get('/acp/status', async (c) => {
    try {
      // Get status from container as well (use same ID as working health check)
      const containerId = c.env.MY_CONTAINER.idFromName('health-check');
      const container = c.env.MY_CONTAINER.get(containerId);

      const containerResponse = await container.fetch(
        new Request("https://container/health")
      );

      let containerHealth = null;
      if (containerResponse.ok) {
        try {
          const responseText = await containerResponse.text();
          containerHealth = JSON.parse(responseText);
        } catch (e) {
          containerHealth = { error: "Invalid container response" };
        }
      }

      return c.json({
        success: true,
        bridge: {
          sessions: Array.from(sessions.values()).slice(0, 50),
          timestamp: new Date().toISOString(),
          version: "enhanced-bridge-v1.0"
        },
        container: containerHealth
      });
    } catch (error) {
      return c.json({
        success: true,
        bridge: {
          sessions: Array.from(sessions.values()).slice(0, 50),
          timestamp: new Date().toISOString(),
          version: "enhanced-bridge-v1.0",
          error: error instanceof Error ? error.message : String(error)
        },
        container: { error: "Container unreachable" }
      });
    }
  });
}

export { sessions };