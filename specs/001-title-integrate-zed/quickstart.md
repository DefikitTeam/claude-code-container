# Quickstart: Enable and test ACP bridge (developer/operator)

Prerequisites
- Cloudflare Worker deployed with Durable Objects enabled
- Operator has configured GitHub App credentials in `/config` endpoint or DO

Steps
1. Register operator mapping (example API - implement later):

   POST /operator/agent-mapping
   {
     "agentId": "zed-agent-1",
     "installationId": "123456",
     "approvedBy": "operator@example.com"
   }

2. Start an ACP session (example via curl):

   curl -X POST https://<worker>/acp/initialize -H 'Content-Type: application/json' -d '{"agentId":"zed-agent-1","capabilities":["repo:read","repo:write"]}'

   Response: { "success": true, "sessionId": "..." }

3. Submit a task resembling a GitHub issue payload to test forwarding:

   curl -X POST https://<worker>/acp/task/execute -H 'Content-Type: application/json' -d '{"id":"msg-1","params":{ "issue": {"id": 99999, "number": 1, "title":"Fix bug","body":"Please fix"}, "repository": {"full_name":"owner/repo"} } }'

   Expected: Worker forwards to the container and returns forwarding status.

4. Check session status:

   GET https://<worker>/acp/status

Notes and troubleshooting
- If forwarding returns 503, check container provisioning (wrangler deploy) and DO availability.
- Check worker logs for session audit events.
