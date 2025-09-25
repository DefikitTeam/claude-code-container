# GitHub Automation Reattachment – Task Board

This checklist re-enables automated GitHub issue/PR creation inside the ACP `session/prompt` flow. Work through tasks sequentially; each ends with a verification cue so you know when it’s safe to proceed.

---

## ✅ 0. Prerequisites
- Current branch: `002-integrate-lumilink-be`
- Worker & container builds passing (`npm run build:container`)
- `/config` Durable Object populated with valid GitHub credentials
- Local git workspace clean (`git status`)

**Verify:** Container build succeeds and repo has no pending changes.

---

## 🧭 1. Recover Legacy Automation Blueprint
- Locate commits/branches where the legacy `/process-prompt` flow created issues/PRs (search `process_issue`).
- Capture branch naming, commit message templates, PR body structure, required inputs.
- Add summary (with links) to `specs/002-integrate-lumilink-be/research.md` under *Legacy automation reference*.

**Verify:** Research doc includes at least one concrete legacy example and documented conventions.

---

## 🔍 2. Audit Credential & Workspace Flow
- Trace `/config` DO → Worker bridge → container handler to confirm secrets flow.
- Validate `WorkspaceService` behavior (path, permissions, cleanup, shallow clone strategy).
- Note any assumptions around secret handling and persistence in `research.md`.

**Verify:** Research doc includes full credential flow narrative/diagram and confirms secrets remain in-memory.

---

## 📐 3. Define Automation Contracts & Data Model
- Update `specs/002-integrate-lumilink-be/data-model.md` with `GitHubAutomationResult`, status codes, branch naming.
- Create/refresh JSON contracts in `specs/002-integrate-lumilink-be/contracts/`:
  - `acp-session-result.json` (extended response schema)
  - `github-automation.json` (issue/PR payload + diagnostics)
- Ensure fields cover success, skipped automation, and error details.

**Verify:** Schemas lint (e.g., `jq . …`) and data model doc references the new contract files.

---

## ⚙️ 4. Refresh Quickstart & Test Strategy
- Expand `quickstart.md` with a “Run automation” section: commands, expected logs, cleanup steps.
- Outline unit/integration/performance test scenarios that align with these tasks.

**Verify:** Quickstart contains explicit automation walkthrough; test scenarios called out for future `/tasks` generation.

---

## 🛠️ 5. Implement `GitHubAutomationService`
- Create `container_src/src/services/github/github-automation.ts` with:
  - Intent detection for when automation runs
  - Workspace preparation & git operations (branch, commit, diff)
  - Octokit issue/PR orchestration with templates/rate limits
  - Cleanup + diagnostic capture
- Add targeted unit tests for success, skip, and error flows.

**Verify:** `npm run test` in `container_src` green; service exported but not yet invoked elsewhere.

---

## 🔗 6. Integrate Automation into `PromptProcessor`
- Inject the new service via `PromptProcessor` dependencies.
- After Claude completes, trigger automation (based on detection or explicit agent context).
- Append `githubAutomation` block to `SessionPromptResponse` and emit `[GITHUB-AUTO]` logs.

**Verify:** Container response JSON includes `githubAutomation`; logs show automation lifecycle; updated tests assert new field.

---

## 🌐 7. Propagate Results Through Worker Layer
- Update Worker bridge (`src/acp-bridge.ts`, `src/index.ts`) and shared types (`src/types.ts`) to surface automation metadata.
- Ensure Durable Object/session logging captures automation results without leaking secrets.

**Verify:** Local `/acp/session/prompt` response includes new fields; worker-side tests in `test/agent-communication` pass.

---

## 🧪 8. Extend Test Coverage
- Container integration test: stub Octokit + git CLI to cover success/failure.
- Worker tests: validate schema compatibility and error propagation.
- Optional: baseline automation duration (<5s typical repo) and record in research doc.

**Verify:** Root `npm run test` passes; performance sample documented.

---

## 📊 9. Telemetry & Fallback Hardening
- Add structured logging around automation start/success/failure.
- Implement retry/backoff for Octokit errors with user-visible diagnostics.
- Ensure workspace cleanup even on failure and gate feature via env flag (e.g., `GITHUB_AUTOMATION_DISABLED`).

**Verify:** Logs show lifecycle + errors; toggling flag disables automation cleanly; temp workspace removed post-run.

---

## 📚 10. Rollout Checklist & Documentation
- Update README/plan with feature flags, verification steps, and known limitations.
- Summarize automation flow & testing results in `plan.md` “Next steps”.
- Draft release notes (or internal announcement) highlighting restored automation.

**Verify:** Docs merged with reviewers’ sign-off; rollout instructions executable independently.

---

## Tracking Table

| Task | Owner | Status | Notes | Evidence |
| ---- | ----- | ------ | ----- | -------- |
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |
| 7 | | | | |
| 8 | | | | |
| 9 | | | | |
| 10 | | | | |

Log URLs, test output, or PR links under **Evidence** to speed up review.
