# Tasks: Integrate Zed ACP for multi-agent communication (CORRECTED)

Feature: Transform Claude Code container into ACP-compliant agent with stdio JSON-RPC interface while maintaining HTTP API backward compatibility.

**Architecture Update**: Original tasks incorrectly assumed HTTP-based Worker endpoints. ACP requires subprocess spawning with stdio JSON-RPC communication. Tasks have been revised to implement the correct protocol.

Prerequisites (checked):
- Feature dir: `/Users/duwm/Documents/LumiLink/claudecode-modern-container/specs/001-title-integrate-zed`
- Updated docs: `plan.md`, `data-model.md`, `contracts/acp-schema.json`, `quickstart.md`

Execution plan (CORRECTED):
- Setup dev environment for container ACP development
- Write failing JSON-RPC contract tests from `contracts/acp-schema.json`
- Implement stdio JSON-RPC handler in container
- Create ACP method handlers (initialize, session/new, session/prompt, etc.)
- Add session management with workspace isolation
- Integration tests with Zed editor ACP client
- Polish: unit tests, docs, performance

Task ordering rules applied:
- Setup tasks first
- JSON-RPC contract tests (must fail) before implementation
- stdio handler before ACP method implementations
- Session management before prompt processing
- Same-file changes are sequential (no [P])
- Different files can be parallel [P]

Parallel execution guidance: group all [P] tasks that reference different files; run JSON-RPC contract tests in parallel with model file creation.

Tasks (numbered) - CORRECTED

T001 - Setup: Container development environment
- Description: Ensure container development dependencies are present. Add ACP-related packages (@zed-industries/agent-client-protocol, JSON-RPC handling libraries).
- Files/paths: `container_src/package.json`, `container_src/pnpm-lock.yaml`
- Success criteria: `cd container_src && pnpm install` completes; existing container tests still pass.

T002 - Setup: Container build configuration
- Description: Update container Dockerfile and build scripts to support ACP interface alongside existing HTTP server.
- Files/paths: `container_src/Dockerfile`, build scripts
- Notes: Ensure both stdio and HTTP interfaces can coexist.

T003 [P] - Test (contract): JSON-RPC initialize method
- Description: Create failing contract test for `initialize` method per `contracts/acp-schema.json`. Test stdio JSON-RPC communication.
- Files/paths: `container_src/tests/contract/acp_initialize.test.ts`
- Command example: `cd container_src && pnpm vitest tests/contract/acp_initialize.test.ts`

T004 [P] - Test (contract): JSON-RPC session/new method
- Description: Create failing contract test for `session/new` method asserting session creation and workspace setup.
- Files/paths: `container_src/tests/contract/acp_session_new.test.ts`
- Command example: `cd container_src && pnpm vitest tests/contract/acp_session_new.test.ts`

T005 [P] - Test (contract): JSON-RPC session/prompt method
- Description: Create failing contract test for `session/prompt` method with content processing and streaming updates.
- Files/paths: `container_src/tests/contract/acp_session_prompt.test.ts`
- Command example: `cd container_src && pnpm vitest tests/contract/acp_session_prompt.test.ts`

T006 [P] - Test (contract): JSON-RPC session/load method
- Description: Create failing contract test for `session/load` method to restore previous session state.
- Files/paths: `container_src/tests/contract/acp_session_load.test.ts`

T007 [P] - Test (contract): JSON-RPC cancel method
- Description: Create failing contract test for `cancel` method to stop ongoing operations.
- Files/paths: `container_src/tests/contract/acp_cancel.test.ts`

T008 [P] - Model: Create JSON-RPC message types
- Description: Implement TypeScript types for ACP JSON-RPC messages per `data-model.md`.
- Files/paths: `container_src/src/types/acp-messages.ts`
- Mark: [P] (independent file)

T009 [P] - Model: Create session management types
- Description: Implement ACPSession, ContentBlock, and AgentCapabilities types.
- Files/paths: `container_src/src/types/acp-session.ts`

T010 [P] - Model: Create workspace isolation types
- Description: Implement workspace state and isolation management types.
- Files/paths: `container_src/src/types/workspace.ts`

T011 - Core: Implement stdio JSON-RPC handler
- Description: Create main stdio interface that reads/writes newline-delimited JSON-RPC messages. Handle method routing and error responses.
- Files/paths: `container_src/src/acp-stdio-handler.ts`
- Depends on: T008 (message types)

T012 - Core: Implement ACP agent capabilities
- Description: Implement `initialize` method handler that returns agent capabilities and version info.
- Files/paths: `container_src/src/acp-methods/initialize.ts`
- Depends on: T008, T011

T013 - Core: Implement session management
- Description: Implement `session/new` and `session/load` methods with workspace isolation and state management.
- Files/paths: `container_src/src/acp-methods/session-management.ts`
- Depends on: T009, T010

T014 - Core: Implement prompt processing
- Description: Implement `session/prompt` method that integrates with existing Claude Code SDK for prompt processing.
- Files/paths: `container_src/src/acp-methods/prompt-handler.ts`
- Depends on: T013, existing Claude Code integration

T015 - Core: Implement streaming updates
- Description: Implement `session/update` notifications for real-time progress streaming during prompt processing.
- Files/paths: `container_src/src/acp-methods/streaming.ts`
- Depends on: T014

T016 - Core: Implement cancellation support
- Description: Implement `cancel` method to stop ongoing operations and clean up resources.
- Files/paths: `container_src/src/acp-methods/cancel.ts`
- Depends on: T014, T015

T017 - Core: Wire ACP interface to main container
- Description: Update container main.js to detect ACP mode (stdio vs HTTP) and route accordingly. Maintain backward compatibility.
- Files/paths: `container_src/src/main.js`
- Depends on: T011, T012, T013, T014, T015, T016

T018 - Core: Workspace isolation implementation
- Description: Implement proper workspace isolation for ACP sessions using Docker volumes or filesystem isolation.
- Files/paths: `container_src/src/workspace-manager.ts`
- Depends on: T010, T013

T019 [P] - Integration tests: Full ACP workflow
- Description: Create integration test that simulates complete Zed ACP workflow: initialize → session/new → session/prompt → session/update notifications.
- Files/paths: `container_src/tests/integration/acp_workflow.test.ts`
- Depends on: T017

T020 [P] - Integration tests: Zed editor compatibility
- Description: Test ACP agent with actual Zed editor configuration from quickstart.md. Verify agent discovery and communication.
- Files/paths: `container_src/tests/integration/zed_compatibility.test.ts`
- Depends on: T017

T021 [P] - Integration tests: Backward compatibility
- Description: Test that existing HTTP API continues to work alongside new ACP stdio interface.
- Files/paths: `container_src/tests/integration/http_compatibility.test.ts`
- Depends on: T017

T022 [P] - Unit tests: JSON-RPC message handling
- Description: Add unit tests for JSON-RPC parsing, validation, and error handling.
- Files/paths: `container_src/tests/unit/jsonrpc.test.ts`

T023 [P] - Unit tests: Session management
- Description: Add unit tests for session lifecycle, workspace isolation, and state management.
- Files/paths: `container_src/tests/unit/session.test.ts`

T024 - Observability: Structured logging for ACP
- Description: Add structured logging for ACP method calls, session events, and error conditions.
- Files/paths: `container_src/src/logger.ts` (extend existing)
- Notes: Distinguish ACP logs from HTTP API logs.

T025 - Polish: Update container documentation
- Description: Update container README and documentation with ACP usage instructions.
- Files/paths: `container_src/README.md`, inline documentation

T026 - Polish: Contract test validation
- Description: Ensure all JSON-RPC contract tests pass. Adjust implementation if needed.
- Depends on: All core implementation tasks

T027 - Performance: ACP performance optimization
- Description: Optimize JSON-RPC parsing, session management, and streaming performance for large repositories.
- Files/paths: Performance monitoring and optimization across ACP components

T028 - Polish: Quickstart validation
- Description: Validate quickstart.md instructions work end-to-end with implemented ACP agent.
- Files/paths: `specs/001-title-integrate-zed/quickstart.md`

Dependency notes (summary):
- Setup: T001, T002 must run first
- Contract tests T003-T007 must be written and fail before implementation
- Message types T008-T010 are prerequisites for method implementations
- stdio handler T011 must exist before ACP methods T012-T016
- Session management T013 must exist before prompt processing T014
- Integration tests T019-T021 run after core implementation T017

Parallel execution examples:
- Parallel group A: T003-T007 (contract tests) + T008-T010 (types)
- Parallel group B: T019-T023 (tests) after T017 (core implementation)

```bash
# Run JSON-RPC contract tests in parallel
cd container_src
pnpm vitest tests/contract/*.test.ts &
pnpm vitest tests/unit/*.test.ts &
wait
```

Sequential execution (critical path):
T011 (stdio handler) → T012 (initialize) → T013 (session mgmt) → T014 (prompt) → T015 (streaming) → T016 (cancel) → T017 (integration)

How to execute a task (example):
- For T003: Create `container_src/tests/contract/acp_initialize.test.ts` with a test that sends JSON-RPC initialize message to container stdio and asserts response matches `contracts/acp-schema.json`. Use test helpers for stdio communication.
- For T011: Create `container_src/src/acp-stdio-handler.ts` that reads stdin for JSON-RPC messages, validates format, routes to method handlers, and writes responses to stdout.

Completion criteria:
- All JSON-RPC contract tests created and initially failing
- Container supports both stdio ACP interface and HTTP API
- All ACP methods implemented per schema
- Integration tests pass with Zed editor
- Backward compatibility maintained
- Performance acceptable for development workflows

Next recommended immediate step:
Create failing JSON-RPC contract tests (T003-T007) and implement message types (T008-T010) in parallel. This establishes clear TDD targets for ACP implementation.
