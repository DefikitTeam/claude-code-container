# Tasks: Integrate Zed ACP for multi-agent communication

Feature: Integrate Zed ACP so the Claude Code container can participate in Zed Agent Client Protocol conversations (handshake, routing, context-sharing, fallback to API).

Prerequisites (checked):
- Feature dir: `/Users/duwm/Documents/LumiLink/claudecode-modern-container/specs/001-title-integrate-zed`
- Available docs used: `plan.md`, `research.md`, `data-model.md`, `contracts/openapi.yaml`, `quickstart.md`

Execution plan (high level):
- Setup dev environment and CI hooks
- Write failing contract tests (TDD) from `contracts/openapi.yaml`
- Create model files from `data-model.md` (TDD)
- Implement Durable Objects (session + queue) and operator-mapping API
- Implement ACP bridge endpoints and wire to container forwarding
- Integration tests for quickstart scenarios
- Polish: unit tests, docs, performance

Task ordering rules applied:
- Setup tasks first
- Contract tests (must fail) before implementation
- Model files before services that use them
- Same-file changes are sequential (no [P])
- Different files can be parallel [P]

Parallel execution guidance: group all [P] tasks that reference different files; run contract tests in parallel with model file creation.

Tasks (numbered)

T001 - Setup: Developer environment
- Description: Ensure repo dev dependencies and tooling are present. Add quick-doc entries for env and Durable Object bindings.
- Files/paths: repository root (no single file change) — verify `package.json`, `pnpm-lock.yaml`, `wrangler.jsonc` and `ENV_TEMPLATE.md` exist.
- Success criteria: `pnpm install` completes; `pnpm -s test` runs (may fail). Dependency for all subsequent tasks.

T002 - Setup: Lint & formatting
- Description: Add/verify lint and formatter config (ESLint/Prettier) and CI step to run them.
- Files/paths: `package.json` (scripts), `.eslintrc.*` or repo lint config; `.github/workflows` (if CI integration required).
- Notes: Run before implementation to keep commits clean.

T003 [P] - Test (contract): POST /acp/initialize
- Description: Create a failing contract test that calls the Worker endpoint described in `contracts/openapi.yaml` and asserts response schema { success:boolean, sessionId:string }.
- Files/paths: `tests/contract/acp_initialize.test.ts`
- Command example: ```pnpm vitest tests/contract/acp_initialize.test.ts``` 

T004 [P] - Test (contract): POST /acp/task/execute
- Description: Create a failing contract test asserting a successful acknowledgement schema { success:boolean, forwarded:boolean, status:number } for task executions.
- Files/paths: `tests/contract/acp_task_execute.test.ts`
- Command example: ```pnpm vitest tests/contract/acp_task_execute.test.ts``` 

T005 [P] - Test (contract): GET /acp/status
- Description: Create a failing contract test that requests `/acp/status` and asserts `{ success: boolean, sessions: array }`.
- Files/paths: `tests/contract/acp_status.test.ts`
- Command example: ```pnpm vitest tests/contract/acp_status.test.ts``` 

T006 [P] - Model: Create `AgentIdentity` model
- Description: Add the AgentIdentity model and basic validation/serialization per `data-model.md`.
- Files/paths: `src/models/agentIdentity.ts`
- Mark: [P] (independent file)

T007 [P] - Model: Create `ACPSession` model
- Description: Add ACPSession model with handshakeState and heartbeat fields.
- Files/paths: `src/models/acpSession.ts`

T008 [P] - Model: Create `ACPMessage` model
- Description: Add ACPMessage shape (type, sender, target, payload, timestamp, signature)
- Files/paths: `src/models/acpMessage.ts`

T009 [P] - Model: Create `OutboundQueueItem` model
- Description: Create model with retries/backoff metadata and helper for computing nextAttemptAt.
- Files/paths: `src/models/outboundQueueItem.ts`

T010 [P] - Model: Create `SessionAuditRecord` model
- Description: Add audit record schema and helper to append audits to session records.
- Files/paths: `src/models/sessionAuditRecord.ts`

T011 [P] - Implement Durable Object: ACP Session (skeleton)
- Description: Implement a production-ready `ACP_SESSION_DO` with storage schema, get/create session endpoints, and audit append API. This is the durable replacement for any in-memory session store.
- Files/paths: `src/durable/acp-session-do.ts` (new) and update Durable Object bindings in `wrangler.jsonc`/`src/durable-objects.ts` if needed.
- Depends on: T006, T007, T010 (models)

T012 [P] - Implement Durable Object: ACP Queue (skeleton)
- Description: Implement `ACP_QUEUE_DO` with enqueue, dequeue, retry/backoff calculation and visibility APIs. Include max-retry and dead-letter semantics.
- Files/paths: `src/durable/acp-queue-do.ts` (new)
- Depends on: T009 (OutboundQueueItem model)

T013 - Core: Operator mapping API (sequential to avoid race in same admin file)
- Description: Implement operator endpoints to register/approve mappings between `agentId` and GitHub `installationId` (admin-only). Persist mappings encrypted (use existing GitHubAppConfigDO pattern or a new DO `USER_CONFIG_DO`).
- Files/paths: `src/user-endpoints.ts` (extend) and `src/user-config-do.ts` (if adding storage)
- Notes: This file likely already exists; modify sequentially (no [P]).

T014 - Core: Wire ACP bridge to use `ACP_SESSION_DO` and `ACP_QUEUE_DO`
- Description: Replace in-memory session handling in `src/acp-bridge.ts` with durable DO calls (session create, fetch, audit append, enqueue outbound messages when needed). Ensure fallback to container.fetch when agent not available.
- Files/paths: `src/acp-bridge.ts` (modify sequentially)
- Depends on: T011, T012, T013

T015 - Core: Implement /acp/initialize endpoint server-side logic
- Description: Implement handshake logic, validate `agentId` mapping, create session record, return `sessionId`. If mapping missing, respond with structured error.
- Files/paths: `src/acp-bridge.ts` (same file - sequential)
- Depends on: T013, T011

T016 - Core: Implement /acp/task/execute handling
- Description: Validate request, check target mapping, convert ACP payload to existing container processing payload (like GitHub issue-like), forward to container (existing `container.fetch` flow), and return ack. On container error, enqueue outbound retry via `ACP_QUEUE_DO`.
- Files/paths: `src/acp-bridge.ts` (same file - sequential)
- Depends on: T012, T011, T014

T017 - Core: Implement /acp/status endpoint
- Description: Return session summaries (limited fields) for operator debugging.
- Files/paths: `src/acp-bridge.ts` (same file - sequential)
- Depends on: T011

T018 [P] - Integration tests: Quickstart scenario - mapping + session + task
- Description: Create integration test(s) that emulate quickstart.md steps: register mapping, call `/acp/initialize`, post a task to `/acp/task/execute` and assert container-forwarding behavior (use a mocked container endpoint or test container stub). Tests should target `tests/integration/quickstart_acp.test.ts`.
- Files/paths: `tests/integration/quickstart_acp.test.ts`
- Depends on: T013, T015, T016

T019 - Integration tests: Fallback behavior (ACP unavailable -> API)
- Description: Test that when agent is unreachable or queue exceeds retries, the Worker falls back to existing API-only behavior (e.g., invoke the container directly or raise operator alert). Put test in `tests/integration/acp_fallback.test.ts`.

T020 [P] - Unit tests: Models and helpers
- Description: Add unit tests for models (validation, nextAttempt calculation) in `tests/unit/models/*`.

T021 - Observability: Structured logging & session audit retention
- Description: Add structured logs for handshake, message routing, enqueue events and store session audit entries in `ACP_SESSION_DO`.
- Files/paths: `src/acp-bridge.ts`, `src/durable/acp-session-do.ts` (changes sequential in bridge)

T022 - Polish: Update `specs/001-title-integrate-zed/quickstart.md` with exact commands and example responses after implementation
- Files/paths: `specs/001-title-integrate-zed/quickstart.md`

T023 - Polish: Contract test pass -> Implementation adjustments
- Description: Make implementation changes until all contract tests pass. CI should run `pnpm vitest --run` and verify all tests.

T024 - Polish [P]: Docs & README
- Description: Add short README in `specs/001-title-integrate-zed/README.md` describing feature, DO names, endpoints, and a “how to run locally” section.

T025 - Performance & safety checks
- Description: Add a small performance smoke test and safety checks (max queue size, retention TTL) and a monitoring alert example.

Dependency notes (summary):
- Setup: T001, T002 must run first
- Contract tests T003-T005 must be written and fail before T015-T017 (implementation)
- Models T006-T010 are prerequisites for DOs (T011-T012)
- DOs T011-T012 must exist before wiring (T014)
- Operator mapping T013 must exist before session establishment (T015)
- Integration tests T018-T019 run after core endpoints implemented

Parallel execution examples
- Parallel group A (can run together): T003, T004, T005 (contract tests) + T006, T007, T008, T009, T010 (models)  
  Command example to run the contracts in parallel locally:

```bash
pnpm vitest tests/contract/*.test.ts &
pnpm vitest tests/unit/models/*.test.ts &
wait
```

- Sequential group B (single file `src/acp-bridge.ts`): T014 -> T015 -> T016 -> T017 (do not parallelize)

How an LLM or agent should execute a task (example)
- For tests (T003): create `tests/contract/acp_initialize.test.ts` with a Vitest test that performs a fetch to the Worker URL (use local dev URL or mock) and asserts response shape according to `contracts/openapi.yaml`. Commit the test and push.
- For DO implementation (T011): create `src/durable/acp-session-do.ts` implementing DO storage and fetch handlers described earlier, add to exports in `src/durable-objects.ts`, and add binding to `wrangler.jsonc` if needed.

Completion criteria
- All contract tests created and initially failing.
- Models created and unit tests in place.
- DOs implemented and used by `src/acp-bridge.ts`.
- All contract tests passing after implementation and integration tests for quickstart succeed.

Next recommended immediate step (lowest friction):
- Create failing contract tests (T003-T005) and model stubs (T006-T010) in parallel. This creates a clear TDD target for subsequent implementation tasks.
