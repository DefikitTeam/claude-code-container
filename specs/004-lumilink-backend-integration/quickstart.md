# LumiLink ACP Integration Quickstart

Validate the ACP-first workflow, rollback safeguards, and GitHub automation continuity before implementation closes.

## Prerequisites
- Current branch: `004-lumilink-backend-integration`
- Node.js 20+, PNPM/NPM installed
- `wrangler` CLI configured for target Cloudflare account
- Anthropic API key with Claude Code access
- GitHub App credentials (App ID, private key, webhook secret, installation ID)
- Test repository where automation can create branches/PRs safely

## 1. Install & Build (lumilink-be)
```bash
# install
pnpm install

# typecheck + build worker (uses wrangler tooling)
pnpm run typecheck
pnpm run build
```

## 2. Configure Secrets
1. Start Worker in local dev mode (optional `--test --persist` for DO storage).
2. POST GitHub App creds to `/config` and register a test user via `/register-user` as outlined in existing quickstart (reuse scripts from prior automation flow).

## 3. Launch Dev Runtime
```bash
# Worker (local)
pnpm dev  # runs: wrangler dev --local --experimental-vectorize-bind-to-prod
```

## 4. Happy Path: ACP Default Session
1. `POST /acp/session/new` with `enableGitOps: true` and target repository.
2. `POST /acp/session/prompt` with automation request.
3. Expected outcomes:
   - Response includes `githubAutomation.status = "success"`.
   - Toast does **not** appear (no skip).
   - ACP telemetry logs show latency <50% of HTTP baseline (compare to legacy metrics).
   - GitHub issue/branch/PR created; response includes `githubAutomation.pullRequest.url`.

## 5. Skip Notification Flow
1. Re-run prompt with repository set to one listed in automation blocklist or remove installation token to simulate missing credential.
2. Expected outcomes:
   - Response contains `githubAutomation.status = "skipped"` and `skipReason`.
   - LumiLink UI displays toast (QA should verify) and transcript gain matching note.
   - `notifications.md` contract satisfied (toast text ≤140 chars, sanitized).

## 6. Auto Rollback Scenario
1. Use test hook to artificially drop success rate (e.g., a debug flag on `AcpConnectionDO` or service to simulate <99% success over 1h).
2. Monitor ACP metrics to confirm success rate <99%.
3. Expected outcomes:
   - Worker emits `[ROLLBACK]` log and schedules protocol change.
   - Subsequent prompts use HTTP path but continue providing automation outputs.
   - `ProtocolMigrationLog` records rollback with reason `autoThreshold`.
   - Toast informs users of temporary fallback.

## 7. Capacity Alert Validation
1. Launch synthetic ACP sessions until reaching 85% of configured limit (use load script).
2. Confirm warning alert triggers (log + analytics metric) but no dropout.
3. Push to 95% to trigger critical alert; verify sessions beyond limit fail fast with explanatory message.

## 8. GitHub Artifacts Review
- Issue labels (`automated`, `claude-prompt`) present.
- Branch naming matches `claude-code/session-<id>` format.
- PR body includes new diagnostics section referencing ACP metrics.
- Transcript contains toast/rollback notes when applicable.

## 9. Cleanup
```bash
# Remove temporary branches and issues (in test repo)
git push origin --delete <feature-branch>
# Use GitHub CLI or web UI to close issues/PRs created during testing
```
Ensure `/tmp` workspaces cleaned automatically; if not, run `rm -rf /tmp/acp-workspaces/*`.

## 10. Regression Checklist
- Vitest suites (root + container) fail before implementation when new tests added.
- Manual flows above produce expected telemetries and notifications.
- Operators receive alerts for capacity and rollbacks (Slack/email/webhook as configured).
