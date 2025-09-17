# Tasks: Integrate Zed ACP for multi-agent communication (CORRECTED)

Feature: Transform Claude Code container into ACP-compliant agent with stdio JSON-RPC interface while maintaining HTTP API backward compatibility.

**Architecture Update**: Original tasks incorrectly assumed HTTP-based Worker endpoints. ACP requires subprocess spawning with stdio JSON-RPC communication. Tasks have been revised to implement the correct protocol.

Prerequisites (checked):
- Feature dir: `/Users/duwm/Documents/LumiLink/claudecode-modern-container/specs/001-title-integrate-zed`
- Updated docs: `plan.md`, `data-model.md`, `contracts/acp-schema.json`, `quickstart.md`

Execution plan (PHASED APPROACH):

**Phase 1: Core ACP Implementation (Basic Single-Turn)**
- Setup dev environment for container ACP development
- Write failing JSON-RPC contract tests from `contracts/acp-schema.json`
- Implement stdio JSON-RPC handler in container
- Create ACP method handlers (initialize, session/new, session/prompt, etc.)
- Add session management with workspace isolation
- Integration tests with Zed editor ACP client
- Polish: unit tests, docs, performance

**Phase 2: Advanced Conversational Features (Multi-Turn Intelligence)**
- Conversational session state management
- Question generation and clarification logic
- Multiple response type handling (needs_clarification, ready_for_implementation, etc.)
- Context accumulation across conversation turns
- Interrupt and adaptation handling
- Advanced conversational patterns and analytics

Task ordering rules applied:
- Setup tasks first
- JSON-RPC contract tests (must fail) before implementation
- stdio handler before ACP method implementations
- Session management before prompt processing
- Same-file changes are sequential (no [P])
- Different files can be parallel [P]

Parallel execution guidance: group all [P] tasks that reference different files; run JSON-RPC contract tests in parallel with model file creation.

## Phase 1 Tasks: Core ACP Implementation (numbered) - CORRECTED

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

---

## Phase 2 Tasks: Advanced Conversational Features (Future Implementation)

**Note**: These tasks implement the advanced conversational intelligence layer discussed in our analysis. They enable multi-turn conversations, clarification requests, and adaptive implementation based on real-time feedback from Context Agents.

T029 [P] - Advanced: Conversational message types
- Description: Extend JSON-RPC message types to support conversational patterns (clarification requests, multiple response types, conversation context).
- Files/paths: `container_src/src/types/conversational-messages.ts`
- Phase: 2 (Advanced Features)
- Depends on: T008 (basic message types)

T030 [P] - Advanced: Conversational session state
- Description: Implement enhanced session management with conversation history, pending questions, and context accumulation across turns.
- Files/paths: `container_src/src/types/conversational-session.ts`
- Phase: 2 (Advanced Features)
- Depends on: T009 (basic session types)

T031 - Advanced: Question generation and clarification
- Description: Implement intelligent question generation when prompts are ambiguous or lack sufficient context for implementation.
- Files/paths: `container_src/src/conversational/question-generator.ts`
- Phase: 2 (Advanced Features)
- Depends on: T029, T030

T032 - Advanced: Multiple response type handling
- Description: Implement support for different conversation response types (needs_clarification, ready_for_implementation, awaiting_approval, etc.).
- Files/paths: `container_src/src/conversational/response-handler.ts`
- Phase: 2 (Advanced Features)
- Depends on: T029, T031

T033 - Advanced: Context accumulation across turns
- Description: Implement conversation context manager that builds comprehensive understanding across multiple message exchanges.
- Files/paths: `container_src/src/conversational/context-accumulator.ts`
- Phase: 2 (Advanced Features)
- Depends on: T030, T032

T034 - Advanced: Interrupt and adaptation handling
- Description: Handle mid-implementation interrupts from Context Agents with new requirements or priority changes.
- Files/paths: `container_src/src/conversational/interrupt-handler.ts`
- Phase: 2 (Advanced Features)
- Depends on: T033, T015 (streaming)

T035 - Advanced: Enhanced prompt processing with conversation
- Description: Upgrade T014 prompt processing to support conversational patterns, clarification detection, and multi-turn workflows.
- Files/paths: `container_src/src/acp-methods/conversational-prompt-handler.ts`
- Phase: 2 (Advanced Features)
- Depends on: T031, T032, T033, T034

T036 - Advanced: Conversational streaming updates
- Description: Upgrade T015 streaming to include conversation-aware updates (questioning, clarifying, adapting) with real-time context sharing.
- Files/paths: `container_src/src/acp-methods/conversational-streaming.ts`
- Phase: 2 (Advanced Features)
- Depends on: T035, T015 (basic streaming)

T037 [P] - Advanced: Conversational contract tests
- Description: Create contract tests for conversational patterns (multi-turn workflows, clarification cycles, interrupt scenarios).
- Files/paths: `container_src/tests/contract/conversational_*.test.ts`
- Phase: 2 (Advanced Features)
- Depends on: T029, T030

T038 [P] - Advanced: Multi-turn integration tests
- Description: Create integration tests that simulate complete conversational workflows between Context Agent and Claude Code Container.
- Files/paths: `container_src/tests/integration/conversational_workflow.test.ts`
- Phase: 2 (Advanced Features)
- Depends on: T035, T036

T039 - Advanced: Conversation analytics and optimization
- Description: Implement conversation pattern analysis and optimization for better multi-agent collaboration over time.
- Files/paths: `container_src/src/conversational/analytics.ts`
- Phase: 2 (Advanced Features)
- Depends on: T038

T040 - Advanced: Conversational documentation and examples
- Description: Document conversational features with examples of multi-turn workflows and best practices for Context Agents.
- Files/paths: `container_src/docs/conversational-features.md`, example workflows
- Phase: 2 (Advanced Features)
- Depends on: T039

## Phase 1 Dependency Notes (T001-T028):
- Setup: T001, T002 must run first
- Contract tests T003-T007 must be written and fail before implementation
- Message types T008-T010 are prerequisites for method implementations
- stdio handler T011 must exist before ACP methods T012-T016
- Session management T013 must exist before prompt processing T014
- Integration tests T019-T021 run after core implementation T017

## Phase 2 Dependency Notes (T029-T040):
- Conversational types T029-T030 extend Phase 1 message/session types
- Question generation T031 is prerequisite for conversational flows
- Enhanced processing T035 upgrades T014 with conversational capabilities
- Conversational streaming T036 upgrades T015 with conversation context
- Phase 2 builds incrementally on completed Phase 1 foundation

## Parallel Execution Examples:

**Phase 1 Parallel Groups:**
- Parallel group A: T003-T007 (contract tests) + T008-T010 (types)
- Parallel group B: T019-T023 (tests) after T017 (core implementation)

**Phase 2 Parallel Groups:**
- Parallel group C: T029-T030 (conversational types) + T037 (conversational contract tests)
- Parallel group D: T038-T040 (integration tests + docs) after T036 (conversational implementation)

```bash
# Phase 1: Run JSON-RPC contract tests in parallel
cd container_src
pnpm vitest tests/contract/*.test.ts &
pnpm vitest tests/unit/*.test.ts &
wait

# Phase 2: Run conversational tests in parallel (future)
pnpm vitest tests/contract/conversational_*.test.ts &
pnpm vitest tests/integration/conversational_*.test.ts &
wait
```

## Sequential Execution (Critical Paths):

**Phase 1 Critical Path:**
T011 (stdio handler) → T012 (initialize) → T013 (session mgmt) → T014 (prompt) → T015 (streaming) → T016 (cancel) → T017 (integration)

**Phase 2 Critical Path:**
T029 (conversational types) → T031 (question generation) → T032 (response types) → T033 (context accumulation) → T035 (enhanced processing) → T036 (conversational streaming)

## How to Execute Tasks (Examples):

**Phase 1 Examples:**
- For T003: Create `container_src/tests/contract/acp_initialize.test.ts` with a test that sends JSON-RPC initialize message to container stdio and asserts response matches `contracts/acp-schema.json`. Use test helpers for stdio communication.
- For T011: Create `container_src/src/acp-stdio-handler.ts` that reads stdin for JSON-RPC messages, validates format, routes to method handlers, and writes responses to stdout.

**Phase 2 Examples:**
- For T031: Create `container_src/src/conversational/question-generator.ts` that analyzes prompts for ambiguities and generates clarification questions using Claude Code's analysis capabilities.
- For T035: Extend T014's prompt handler to detect when clarification is needed and return `stopReason: "needs_clarification"` with generated questions.

## Phase 1 Completion Criteria:
- ✅ All JSON-RPC contract tests created and initially failing
- ✅ Container supports both stdio ACP interface and HTTP API
- ✅ All basic ACP methods implemented per schema
- ✅ Integration tests pass with Zed editor
- ✅ Backward compatibility maintained
- ✅ Performance acceptable for development workflows
- ✅ **Single-turn conversations work**: Context Agent → Claude → Result

## Phase 2 Completion Criteria (Future):
- ✅ Multi-turn conversations supported
- ✅ Claude can ask clarification questions
- ✅ Context accumulation across conversation turns
- ✅ Real-time adaptation to Context Agent feedback
- ✅ Advanced conversational patterns documented and tested

## Implementation Strategy:

**Phase 1 Focus (Immediate):**
Start with Phase 1 tasks (T001-T028) to establish solid ACP foundation. This provides:
- ✅ **Basic agent-to-agent communication** via ACP protocol
- ✅ **Simple request-response patterns** that work with any Context Agent
- ✅ **Proven integration** with Zed editor and other ACP clients
- ✅ **Stable foundation** for future conversational enhancements

**Phase 2 Migration (Future):**
After Phase 1 is stable and proven, implement Phase 2 tasks (T029-T040) to add conversational intelligence. This provides:
- 🚀 **Advanced multi-turn conversations** between agents
- 🚀 **Intelligent clarification and question generation**
- 🚀 **Real-time adaptation** to changing requirements
- 🚀 **Sophisticated collaborative workflows**

## Next Recommended Immediate Step:
**Begin Phase 1**: Create failing JSON-RPC contract tests (T003-T007) and implement message types (T008-T010) in parallel. This establishes clear TDD targets for basic ACP implementation and gets the fundamental agent communication working first.
