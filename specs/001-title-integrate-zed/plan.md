# Implementation Plan: Integrate Zed ACP for multi-agent communication

Branch: `001-title-integrate-zed` | Date: 2025-09-15 | Spec: `/Users/duwm/Documents/LumiLink/claudecode-modern-container/specs/001-title-integrate-zed/spec.md`

## Summary
Primary requirement: Transform the Claude Code container into an ACP-compliant agent that can participate in multi-agent conversations via Zed's Agent Client Protocol. The container will expose a stdio JSON-RPC interface for ACP communication while maintaining backward compatibility with existing HTTP API workflows.

**Architecture Change**: The original plan incorrectly assumed HTTP-based ACP endpoints. ACP requires subprocess spawning with stdio JSON-RPC communication. This plan has been revised to implement the correct ACP protocol.

This plan follows the repository's plan-template and produces Phase 0 (research) and Phase 1 (design/contracts) artifacts. Phase 2 (task generation) is described but not executed here.

## Checklist (what I'll produce in this plan)
- [x] Phase 0 research artifacts: `research.md` (UPDATED with correct ACP understanding)
- [ ] Phase 1 design artifacts: `data-model.md`, `contracts/acp-schema.json`, `quickstart.md` (REVISED)
- [ ] Phase 2 approach described (tasks.md will be produced by `/tasks` per template)

---

## Technical Context (CORRECTED)
- Language / Platform: TypeScript / Cloudflare Workers + Container Runtime
- Project type: Web/API (Cloudflare Worker + Durable Objects + container runtime + ACP agent)
- Storage: Durable Objects for session persistence, file-based storage in container for ACP state
- Testing: existing repo uses Vitest; JSON-RPC contract tests and integration tests required
- Constraints / Assumptions:
  - **ACP Protocol**: JSON-RPC 2.0 over stdio, subprocess spawning model (NOT HTTP endpoints)
  - **Container Role**: Claude Code container becomes an ACP-compliant agent subprocess
  - **Communication**: stdio JSON-RPC between Zed (client) and container (agent)
  - **Backward Compatibility**: Maintain existing HTTP API while adding ACP stdio interface

## Constitution Check (initial)
- Simplicity: Plan keeps implementation as a focused library module (`src/acp-bridge.ts`) and uses existing Durable Objects for persistence. No extra project splits.
- Testing: TDD is required — contract tests will be generated and must fail before implementation.
- Observability: structured logging and session audit events are part of requirements.

No constitution violations identified that block Phase 0.

---

## Phase 0 (research) — artifacts: `research.md`
See `/Users/duwm/Documents/LumiLink/claudecode-modern-container/specs/001-title-integrate-zed/research.md` for resolved clarifications. Decisions made there (summary):
- Authorization mapping: use an operator-mapped trust model by default where ACP agent identities are mapped to registered installation IDs (operator approval required). Offer an optional automatic mapping mode for fully trusted internal agents.
- Context size: default safe payload of 250 KB / 8k tokens for message bodies; larger contexts must be delivered as references (file diffs, repo snapshots) and not inlined.
- Persistence: use Durable Objects for session records and outbound queue; in-memory only for demo.
- Transport: support HTTP POST-based ACP messages first, add WebSocket or persistent connections later if needed.

Gate: all NEEDS CLARIFICATION items from spec must be resolved in `research.md` before Phase 1; that file is present.

---

## Phase 1 (design & contracts)
Artifacts generated:
- `data-model.md` — JSON-RPC message types, session entities, and state transitions
- `contracts/acp-schema.json` — JSON-RPC method schemas and message formats for ACP protocol
- `quickstart.md` — operator guide to run container as ACP agent with Zed

Design decisions (CORRECTED):
- **Container ACP Agent**: Transform Claude Code container into ACP-compliant agent subprocess
- **Dual Interface**: Container supports both HTTP API (existing) and stdio JSON-RPC (new ACP)
- **Session Management**: In-container session state with optional Durable Object persistence
- **Authorization model**:
  - ACP agents authenticate via GitHub installation tokens (inherited from container environment)
  - Session isolation: each ACP session = isolated workspace within container
  - Permission model: inherit GitHub App permissions for repository operations
- **Communication Flow**:
  ```
  Zed Editor → spawn container → stdio JSON-RPC → Claude Code Agent
                    ↓
                GitHub API operations (via existing container logic)
  ```

ACP Method Implementation:
- `initialize` — return agent capabilities and protocol version
- `session/new` — create isolated workspace session
- `session/prompt` — process user prompt with Claude Code logic
- `session/update` — stream progress notifications
- `session/load` — restore previous session state

See `contracts/acp-schema.json` for complete JSON-RPC schemas.

Constitution re-check: design keeps feature as a focused library, includes contract tests (to add next), and preserves observability requirements.

### ACP Protocol Implementation (JSON-RPC over stdio)

**Transport Layer**:
- **Primary**: JSON-RPC 2.0 over stdin/stdout (required by ACP spec)
- **Process Model**: Container runs as subprocess spawned by Zed editor
- **Message Format**: Newline-delimited JSON-RPC messages

**Core ACP Methods**:
```javascript
// Initialize agent capabilities
{ "jsonrpc": "2.0", "id": 1, "method": "initialize",
  "params": { "protocolVersion": "0.3.1", "clientCapabilities": {...} } }

// Create new session
{ "jsonrpc": "2.0", "id": 2, "method": "session/new",
  "params": { "workspaceUri": "file:///repo" } }

// Send user prompt
{ "jsonrpc": "2.0", "id": 3, "method": "session/prompt",
  "params": { "sessionId": "uuid", "content": [...] } }

// Stream updates (notification)
{ "jsonrpc": "2.0", "method": "session/update",
  "params": { "sessionId": "uuid", "content": [...] } }
```

**Container Integration**:
- Add stdio JSON-RPC handler to existing container main.js
- Route ACP sessions to isolated workspaces
- Maintain existing HTTP API for backward compatibility
- Use existing Claude Code SDK for prompt processing

---

## Phase 2 (task planning approach — description only)
What `/tasks` must produce (CORRECTED):
- JSON-RPC contract test tasks (one per ACP method) — mark as failing tests
- Container stdio interface implementation tasks
- ACP agent capability implementation tasks
- Session management and workspace isolation tasks
- Integration tests with Zed editor ACP client
- Backward compatibility tests for existing HTTP API

Estimated total tasks: 15–25. Ordered: JSON-RPC contracts → stdio handler → ACP methods → session management → integration tests.

---

## Outputs (file paths)
- Implementation plan: `/Users/duwm/Documents/LumiLink/claudecode-modern-container/specs/001-title-integrate-zed/plan.md` (this file - UPDATED)
- Research: `/Users/duwm/Documents/LumiLink/claudecode-modern-container/specs/001-title-integrate-zed/research.md` (TO UPDATE)
- Data model: `/Users/duwm/Documents/LumiLink/claudecode-modern-container/specs/001-title-integrate-zed/data-model.md` (TO UPDATE)
- Quickstart: `/Users/duwm/Documents/LumiLink/claudecode-modern-container/specs/001-title-integrate-zed/quickstart.md` (TO UPDATE)
- Contracts: `/Users/duwm/Documents/LumiLink/claudecode-modern-container/specs/001-title-integrate-zed/contracts/acp-schema.json` (TO CREATE)

**Status**: Plan updated with correct ACP architecture. Next steps:
1. Update research.md with ACP findings
2. Redesign data-model.md for JSON-RPC messages
3. Create acp-schema.json with method definitions
4. Revise quickstart.md for container ACP agent usage
# Implementation Plan: [FEATURE]


**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from context (web=frontend+backend, mobile=app+api)
   → Set Structure Decision based on project type
3. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
4. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
5. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, or `GEMINI.md` for Gemini CLI).
6. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
7. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
8. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary
[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context
**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]  
**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]  
**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]  
**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]  
**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]
**Project Type**: [single/web/mobile - determines source structure]  
**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]  
**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]  
**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Simplicity**:
- Projects: [#] (max 3 - e.g., api, cli, tests)
- Using framework directly? (no wrapper classes)
- Single data model? (no DTOs unless serialization differs)
- Avoiding patterns? (no Repository/UoW without proven need)

**Architecture**:
- EVERY feature as library? (no direct app code)
- Libraries listed: [name + purpose for each]
- CLI per library: [commands with --help/--version/--format]
- Library docs: llms.txt format planned?

**Testing (NON-NEGOTIABLE)**:
- RED-GREEN-Refactor cycle enforced? (test MUST fail first)
- Git commits show tests before implementation?
- Order: Contract→Integration→E2E→Unit strictly followed?
- Real dependencies used? (actual DBs, not mocks)
- Integration tests for: new libraries, contract changes, shared schemas?
- FORBIDDEN: Implementation before test, skipping RED phase

**Observability**:
- Structured logging included?
- Frontend logs → backend? (unified stream)
- Error context sufficient?

**Versioning**:
- Version number assigned? (MAJOR.MINOR.BUILD)
- BUILD increments on every change?
- Breaking changes handled? (parallel tests, migration plan)

## Project Structure

### Documentation (this feature)
```
specs/[###-feature]/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (repository root)
```
# Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure]
```

**Structure Decision**: [DEFAULT to Option 1 unless Technical Context indicates web/mobile app]

## Phase 0: Outline & Research
1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Generate and dispatch research agents**:
   ```
   For each unknown in Technical Context:
     Task: "Research {unknown} for {feature context}"
   For each technology choice:
     Task: "Find best practices for {tech} in {domain}"
   ```

3. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen]
   - Alternatives considered: [what else evaluated]

**Output**: research.md with all NEEDS CLARIFICATION resolved

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Extract entities from feature spec** → `data-model.md`:
   - Entity name, fields, relationships
   - Validation rules from requirements
   - State transitions if applicable

2. **Generate API contracts** from functional requirements:
   - For each user action → endpoint
   - Use standard REST/GraphQL patterns
   - Output OpenAPI/GraphQL schema to `/contracts/`

3. **Generate contract tests** from contracts:
   - One test file per endpoint
   - Assert request/response schemas
   - Tests must fail (no implementation yet)

4. **Extract test scenarios** from user stories:
   - Each story → integration test scenario
   - Quickstart test = story validation steps

5. **Update agent file incrementally** (O(1) operation):
   - Run `/scripts/bash/update-agent-context.sh copilot` for your AI assistant
   - If exists: Add only NEW tech from current plan
   - Preserve manual additions between markers
   - Update recent changes (keep last 3)
   - Keep under 150 lines for token efficiency
   - Output to repository root

**Output**: data-model.md, /contracts/*, failing tests, quickstart.md, agent-specific file

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Load `/templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Each contract → contract test task [P]
- Each entity → model creation task [P] 
- Each user story → integration test task
- Implementation tasks to make tests pass

**Ordering Strategy**:
- TDD order: Tests before implementation 
- Dependency order: Models before services before UI
- Mark [P] for parallel execution (independent files)

**Estimated Output**: 25-30 numbered, ordered tasks in tasks.md

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [ ] Phase 0: Research complete (/plan command)
- [ ] Phase 1: Design complete (/plan command)
- [ ] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [ ] Initial Constitution Check: PASS
- [ ] Post-Design Constitution Check: PASS
- [ ] All NEEDS CLARIFICATION resolved
- [ ] Complexity deviations documented

---
*Based on Constitution v2.1.1 - See `/memory/constitution.md`*