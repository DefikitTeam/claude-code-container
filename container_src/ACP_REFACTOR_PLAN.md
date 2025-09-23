# ACP Handlers Modularization & OOP Refactor Plan

> Status: Draft architectural plan to decompose `handlers/acp-handlers.ts` into modular, testable services.
> Scope: `container_src/src` (container runtime). Root worker `src/` remains untouched by this plan.

## 0. Goals
- Reduce `acp-handlers.ts` (~1700 lines) into cohesive modules (< 300–400 lines each; hard cap < 500).
- Improve testability (unit + orchestration layers).
- Preserve current behavior & instrumentation (stderr capture, diagnostics) during incremental extraction.
- Introduce clear domain boundaries (session, workspace, git, auth, diagnostics, Claude client, prompt orchestration, handlers).
- Enable future multi-implementation strategies (e.g. alternate Claude runners, different auth modes) without deep rewrites.

## 1. Final Target Module Map
```
container_src/src/
  core/
    prompts/prompt-utils.ts
    errors/error-classifier.ts
    diagnostics/diagnostics-service.ts
  services/
    session/session-store.ts
    workspace/workspace-service.ts
    git/git-service.ts
    auth/auth-service.ts
    claude/claude-client.ts
    prompt/prompt-processor.ts   # Facade / Orchestrator
  handlers/
    initialize-handler.ts
    session-new-handler.ts
    session-prompt-handler.ts
    session-load-handler.ts
    cancel-handler.ts
    index.ts  # aggregates exported handlers
```

### Optional Hybrid (if simplifying initially)
```
services/
  claude/claude-client.ts
  prompt/prompt-processor.ts
  session/session-store.ts
  workspace-service.ts
  git-service.ts
  auth-service.ts
```

## 2. Design Patterns Applied
| Concern | Pattern | File(s) |
|---------|---------|---------|
| Prompt orchestration | Facade | `services/prompt/prompt-processor.ts` |
| Swappable model/runner modes | Strategy (future) | `services/claude/claude-client.ts` |
| Event streaming to caller | Observer-lite (callbacks) | `claude-client.ts` |
| Boundary segregation | Bounded Context | folder structure |
| Error normalization | Adapter + Classifier | `core/errors/error-classifier.ts` |
| Dependency wiring | Manual DI (optionally Container later) | construction in handler bootstrap |

## 3. Extraction Phases (Incremental Strategy)
Each phase = copy → import → delete original code → build + tests pass.

### Phase 0 (Optional) – Baseline Smoke Test
Create a minimal test simulating: initialize → session/new → session/prompt with a mocked Claude stream.

### Phase 1 – Pure Utilities
- Extract: token estimation, summarization, prompt formatting → `core/prompts/prompt-utils.ts`.
- Extract: `classifyClaudeError` + pattern tables → `core/errors/error-classifier.ts`.
Acceptance: `acp-handlers.ts` imports these; no logic drift; tests for edge cases.

### Phase 2 – Session Store
- File: `services/session/session-store.ts`
- Responsibilities: load/save/list/exist; hide FS paths; JSON schema validation stub.
- Provide interface `ISessionStore` for DI.

### Phase 3 – Workspace & Git Services
- `workspace-service.ts`: ephemeral workspace creation, path calculations.
- `git-service.ts`: repo init, status, uncommitted change detection.
- Workspace may depend on Git service when ensuring repo state.

### Phase 4 – Auth & Diagnostics
- `auth-service.ts`: ensure auth files, env-only mode, safe cleanup.
- `diagnostics-service.ts`: run raw CLI diagnostics, stderr capture normalization, structured result.

### Phase 5 – Claude Client Adapter
- `claude-client.ts`: Wrap existing `query()` iteration. Accept callbacks: onStart, onDelta, onComplete, onError.
- Provide future extension point for alternative engines.

### Phase 6 – Prompt Processor (Facade)
- `prompt-processor.ts`: Orchestrate: load session → workspace prep → auth → diagnostics → run Claude → persist updates → return structured result.
- Accept dependencies via constructor.

### Phase 7 – Individual Handlers
- Split ACP JSON-RPC methods into dedicated files.
- Keep `handlers/index.ts` returning an object mapping method → function.
- Shrink or remove `acp-handlers.ts` (becomes simple re-export shim until callers updated).

### Phase 8 – Cleanup & Guardrails
- Remove dead code / legacy comments.
- Add line-length CI guard (script: `scripts/check-line-limits.mjs`).
- Document architecture in this file + short README section.

## 4. Testing Matrix
| Module | Test Focus |
|--------|------------|
| prompt-utils | token estimation boundaries; summarization truncation |
| error-classifier | map stderr patterns to codes |
| session-store | create/update/missing session handling |
| git-service | init vs existing; dirty state detection |
| workspace-service | unique ephemeral path, failure on permission error |
| auth-service | env-only vs file mode; idempotency |
| diagnostics-service | simulated stderr parsing; CLI missing case |
| claude-client | callback order, error propagation |
| prompt-processor | happy path + classified failure + cancellation |
| handlers | thin glue; correct dependency invocation |

## 5. Dependency Injection Plan
Manual DI suffices initially:
```
const sessionStore = new SessionStore(...)
const gitService = new GitService(...)
const workspaceService = new WorkspaceService({ gitService })
const authService = new AuthService(...)
const diagnosticsService = new DiagnosticsService(...)
const claudeClient = new ClaudeClient(...)
const promptProcessor = new PromptProcessor({
  sessionStore,
  workspaceService,
  authService,
  diagnosticsService,
  claudeClient,
  errorClassifier,
  promptUtils
})
```
Handlers receive `promptProcessor` + `sessionStore` as needed.

## 6. Error Handling & Classification
Centralize in `error-classifier.ts`:
- Input: raw error (stderr, message, code)
- Output: `{ code: string; message: string; isRetryable: boolean; meta?: any }`
Codes: `auth_error`, `cli_missing`, `workspace_missing`, `fs_permission`, `internal_cli_failure`, `cancelled`, `unknown`.

## 7. Streaming Contract
`ClaudeClient.runPrompt(opts, callbacks)`:
- `callbacks.onStart(meta)`
- `callbacks.onDelta(partial)` (token/line increment)
- `callbacks.onComplete(final)`
- `callbacks.onError(error)`
Backpressure: simple fire-and-forget for now; later can introduce async queue if needed.

## 8. Cancellation Strategy
- Introduce `CancellationToken` passed through `prompt-processor` → `claude-client`.
- `claude-client` checks token each iteration; throws structured `{ code: 'cancelled' }`.

## 9. Logging & Diagnostics Preservation
- Keep existing log levels (debug/info/error) centralized (future improvement: `logger.ts`).
- Diagnostics service returns structured object appended to session or emitted in logs if error.

## 10. Acceptance Criteria Summary
- After Phase 7: No direct FS or `child_process` logic left inside handler functions.
- `acp-handlers.ts` reduced to < 100 lines (or retired).
- All new modules have at least 1 unit test.
- Build + tests + line-length check pass.

## 11. Rollback & Risk Mitigation
- Each phase committed separately → easy `git revert`.
- Behavior parity checked by smoke test comparing log markers & handler responses.
- Do not alter wire protocol (ACP JSON-RPC shapes) until post-refactor.

## 12. Suggested Commit Messages
```
refactor(acp): extract prompt & error utilities (phase 1)
refactor(acp): add session store service (phase 2)
refactor(acp): add workspace & git services (phase 3)
refactor(acp): extract auth + diagnostics (phase 4)
refactor(acp): introduce claude client adapter (phase 5)
refactor(acp): add prompt processor facade (phase 6)
refactor(acp): split individual ACP handlers (phase 7)
chore(acp): add line length guard & docs (phase 8)
```

## 13. Future Enhancements (Post-Refactor)
- Metrics hooks (latency per phase, token usage).
- Pluggable `ClaudeClient` strategies (CLI vs SDK vs remote service).
- Structured logging + tracing IDs.
- Caching of prompt summaries / token estimates.
- Session lifecycle policies (expiration / pruning).

## 14. Quick Start for Phase 1
```
mkdir -p src/core/prompts src/core/errors
# Copy functions from acp-handlers.ts into new files
# Replace original code blocks with imports
npm run build
npm test   # ensure smoke test passes (if implemented)
```

---
**End of Plan**
