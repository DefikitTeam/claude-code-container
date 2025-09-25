# LumiLink-BE GitHub Automation Quick Start

This guide walks through running the restored GitHub automation flow end-to-end
and highlights the test strategy that should accompany each change. Complete the
steps in order to validate the system locally before opening a pull request.

## Prerequisites

- Current branch: `002-integrate-lumilink-be`
- Node.js 20+
- `wrangler` CLI configured for the target Cloudflare account
- GitHub App credentials (App ID, private key, webhook secret, installation ID)
- Anthropic API key with Claude Code access
- GitHub repository where automation is allowed to create branches/PRs

> **Tip:** Keep a throwaway repository handy for smoke-testing the automation so
> that unexpected PRs do not spam production projects.

## Bootstrap the Workspace

```bash
# 1. Install dependencies
npm install
cd container_src && npm install

# 2. Build both layers once to ensure types are valid
npm run build --workspace=.
cd container_src && npm run build

# 3. Run lint/tests (optional but recommended before validating automation)

cd container_src && npm test
```

## Configure Secrets

1. **Configure GitHub App settings** (once per environment):

   ```bash
   wrangler dev --local --test --persist # optional local DO store
   ```

   Then POST the decrypted credentials to the worker:

   ```bash
   curl -X POST http://localhost:8787/config \
     -H 'content-type: application/json' \
     -d '{
           "appId": "<APP_ID>",
           "privateKey": "-----BEGIN PRIVATE KEY-----...",
           "webhookSecret": "<WEBHOOK_SECRET>",
           "installationId": "<INSTALLATION_ID>"
         }'
   ```

2. **Register the test user / Anthropic key** (if multi-tenant):

   ```bash
   curl -X POST http://localhost:8787/register-user \
     -H 'content-type: application/json' \
     -d '{
           "installationId": "<INSTALLATION_ID>",
           "anthropicApiKey": "<ANTHROPIC_API_KEY>",
           "userId": "qa-user"
         }'
   ```

The Durable Objects now contain the encrypted credentials that will be handed to
the container on each request.

## Run the Automation Flow

### 1. Start worker and container watchers

```bash
# Terminal A – worker (Cloudflare)
wrangler dev --local

# Terminal B – container hot reload
cd container_src
npm run dev
```

Watch the logs from both terminals during the automation run.

### 2. Create an ACP session bound to your repo

Request a new session through the ACP bridge. Capture the returned `sessionId`
for the next step.

```bash
curl -X POST http://localhost:8787/acp/session/new \
  -H 'content-type: application/json' \
  -d '{
        "userId": "qa-user",
        "installationId": "<INSTALLATION_ID>",
        "workspaceUri": "file:///tmp/claude-workspaces/qa-user",
        "sessionOptions": {
          "enableGitOps": true,
          "persistHistory": true
        }
      }'
```

> **Note:** The worker forwards the payload directly to the container as ACP
> `session/new`. Extra keys (like `installationId`) are preserved so automation
> services can pick them up once implemented.

### 3. Send an ACP session prompt (automation happy path)

Substitute the `sessionId` from the previous command. The `content` array follows
the ACP schema. Include repository context so the automation layer knows where
to operate.

```bash
curl -X POST http://localhost:8787/acp/session/prompt \
  -H 'content-type: application/json' \
  -d '{
        "sessionId": "<SESSION_ID>",
        "userId": "qa-user",
        "installationId": "<INSTALLATION_ID>",
        "context": {
          "repository": "your-org/automation-sandbox",
          "branch": "main",
          "automation": {
            "mode": "github",
            "issueTitle": "Add automation badge to README"
          }
        },
        "content": [
          {
            "type": "text",
            "text": "Update README to include an automation badge and adjust installation steps."
          }
        ]
      }'
```

The worker responds with a JSON-RPC envelope:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "stopReason": "completed",
    "usage": {
      "inputTokens": 1234,
      "outputTokens": 567
    },
    "githubAutomation": { "status": "success", "branch": "claude-code/issue-123" },
    "meta": { "githubAutomationVersion": "1.0.0" }
  },
  "id": 1695692800000
}
```

### 4. Observe expected logs

During a successful run you should see, in order:

- `[ACP-BRIDGE]` log lines in the worker confirming `session/new` then
  `session/prompt`
- `[SESSION-PROMPT]` / `[PROMPT]` container logs showing Claude execution
- `[GIT]`/`[WORKSPACE]` entries demonstrating shallow clone + branch creation
- `[GITHUB-AUTO] start` with repository metadata
- `[GITHUB-AUTO] success` containing `branch`, `issue`, `pullRequest` references

Failures will emit `[GITHUB-AUTO] error` with `code` matching the JSON contract.

### 5. Validate GitHub side-effects

1. Confirm the issue exists (labels: `automated`, `claude-prompt`).
2. Confirm the feature branch on GitHub (e.g., `claude-code/issue-123-...`).
3. If changes were pushed, confirm the linked pull request and the summary body
   includes `.claude-pr-summary.md` contents.
4. Confirm the ACP response `result.githubAutomation` matches the artifacts
  (branch URL, issue number, PR URL).

### 6. Cleanup

Automation should clean up ephemeral workspaces automatically, but you can
double-check:

```bash
cd container_src
ls /tmp | grep claude-workspace || echo "no stray workspaces"
```

To revert the GitHub artifacts after testing:

```bash
git push origin --delete claude-code/issue-<number>-<timestamp>
gh issue close <issue-number> --delete
gh pr close <pr-number> --delete-branch
```

## Testing Strategy

Testing should mirror the scenarios surfaced above. Implement the following
suites before shipping automation changes.

### Unit Tests (container_src)

- `GitHubAutomationService`
  - Creates issue + branch + PR on success (Octokit mock)
  - Skips automation when feature flag disabled or repo filtered out
  - Returns structured error when git push fails (simulated non-zero exit)
- Workspace helpers
  - Ensures cleanup always executes on success/failure paths
  - Validates branch naming utility yields deterministic results

### Integration Tests

- Container-side (`container_src/test/github-automation.integration.test.ts`)
  - Full prompt → automation pipeline using fixture repo + mocked Octokit
  - Verifies `githubAutomation` block matches schema in
    `contracts/github-automation.json`
- Worker-side (`test/agent-communication/github-automation.test.mjs`)
  - Drives `/acp/session/new` and `/acp/session/prompt` with mocked Durable Object config
  - Asserts JSON-RPC `result.githubAutomation` propagates to HTTP response
  - Exercises retry behaviour when container returns `503`

### Performance & Regression Checks

- Measure automation duration with a small repo (<5s target) and document it in
  `research.md`
- Add a smoke test that ensures temp workspaces are deleted (check `/tmp`)
- Verify rate-limit handling by simulating `403`/`429` responses and ensuring
  they downgrade to `status: "error"` with `retryable: true`

## Next Steps

After validating the flow locally and adding tests, capture evidence (logs,
artifacts, screenshots) in the task tracker and move on to implementing the
remaining tasks in the GitHub automation plan while keeping the ACP bridge and
legacy HTTP fallbacks consistent.
