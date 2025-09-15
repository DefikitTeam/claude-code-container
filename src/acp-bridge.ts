import { Hono } from "hono";
import type { Env, ACPMessage, ACPSession, GitHubIssuePayload, ContainerRequest } from "./types";

// Minimal ACP bridge with a single coherent implementation.
// Demo note: this uses an in-memory session map; replace with Durable Objects for production.
const sessions: Map<string, ACPSession> = new Map();

export function addACPEndpoints(app: Hono<{ Bindings: Env }>) {
  app.post('/acp/initialize', async (c) => {
    const body = await c.req.json();
    const agentId = body.agentId || `agent-${Date.now()}`;
    const sessionId = crypto.randomUUID();

    const session: ACPSession = { sessionId, agentId, capabilities: body.capabilities || [], createdAt: Date.now(), lastSeenAt: Date.now() };
    sessions.set(sessionId, session);
    return c.json({ success: true, sessionId, agentId });
  });

  app.post('/acp/task/execute', async (c) => {
    const msg = await c.req.json() as ACPMessage;
    const payload = (msg as any).params || (msg as any).payload;

    // If the payload is a GitHub issue payload, forward to the container processing flow
    if (payload && payload.issue && payload.repository) {
      try {
        const issue = payload as GitHubIssuePayload;
        const containerId = c.env.MY_CONTAINER.idFromName(`acp-issue-${issue.issue.id}`);
        const container = c.env.MY_CONTAINER.get(containerId);

        const containerRequest: ContainerRequest = { type: 'process_issue', payload, config: { appId: c.env.FIXED_GITHUB_APP_ID || '', privateKey: '', webhookSecret: '' } };

        const resp = await container.fetch(new Request('https://container/process-issue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(containerRequest) }));
        const text = await resp.text();
        let parsed: any = null; try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
        return c.json({ success: true, forwarded: true, status: resp.status, result: parsed });
      } catch (err) {
        return c.json({ success: false, error: (err as Error).message || String(err) }, 500);
      }
    }

    const target = (msg as any).target;
    if (target && sessions.has(target)) { const s = sessions.get(target)!; s.lastSeenAt = Date.now(); return c.json({ success: true, deliveredTo: s.sessionId }); }

    return c.json({ success: true, queued: true });
  });

  app.get('/acp/status', (c) => c.json({ success: true, sessions: Array.from(sessions.values()).slice(0, 50) }));
}

export { sessions };