# Implementation Plan: Integrate Zed ACP for multi-agent communication

Branch: `001-title-integrate-zed` | Date: 2025-09-15 | Spec: `/Users/duwm/Documents/LumiLink/claudecode-modern-container/specs/001-title-integrate-zed/spec.md`

## Summary
Primary requirement: Replace the container's API-only communications with an ACP-capable bridge so the Claude Code agent can participate in multi-agent conversations over Zed ACP: perform handshake, route messages, share context, execute mapped workflows (e.g., GitHub issue -> container processing -> PR), and fall back to existing API flows when ACP is unreachable.

This plan follows the repository's plan-template and produces Phase 0 (research) and Phase 1 (design/contracts) artifacts. Phase 2 (task generation) is described but not executed here.

## Checklist (what I'll produce in this plan)
- [x] Phase 0 research artifacts: `research.md` (resolving NEEDS CLARIFICATION)
- [x] Phase 1 design artifacts: `data-model.md`, `contracts/openapi.yaml`, `quickstart.md`
- [x] Phase 2 approach described (tasks.md will be produced by `/tasks` per template)

---

## Technical Context (inferred / assumptions)
- Language / Platform: TypeScript / Cloudflare Workers (existing repo)
- Project type: Web/API (Cloudflare Worker + Durable Objects + container runtime)
- Storage: Durable Objects for persistent state (recommended), in-memory only for demo
- Testing: existing repo uses Vitest; contract tests and integration tests are required per constitution
- Constraints / Assumptions:
  - Zed ACP provides an HTTP or WebSocket-based agent protocol (assume HTTP-compatible endpoints)
  - ACP identity material (keys) and mapping to GitHub installations must be provided by operator or via an admin UI
  - For Phase 0 we choose conservative defaults (message size, retry/backoff) that can be tuned

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
- `data-model.md` — entities, fields, validation and state transitions
- `contracts/openapi.yaml` — minimal OpenAPI specification for ACP endpoints the Worker will expose
- `quickstart.md` — minimal operator quickstart to configure and test ACP

Design decisions (high level):
- Expose an ACP HTTP bridge in the Worker at `/acp/*` that accepts ACP messages and forwards mapped messages to the same Durable Object container flow used by webhooks and prompt processing.
- Use Durable Objects:
  - `ACP_SESSION_DO` — store session records (sessionId, agentId, capabilities, lastSeen, trustLevel)
  - `ACP_QUEUE_DO` — persistent outbound queue with retry/backoff metadata
- Authorization model:
  - Primary (safe) mode: operator maps ACP agent public key or id -> GitHub installation id / user. Actions requiring repository privileges require that mapping.
  - Admin approval workflow required for new mappings.
  - Optional: local allow-list for internal agents (dev/test only).
- Context sharing policy:
  - Small contexts inline (<= 8k tokens). Larger contexts referenced by artifact id (container-hosted workspace snapshot, pre-created repo patch) and fetched by agent on demand.

Contracts highlights:
- POST /acp/initialize — register session (returns sessionId)
- POST /acp/task/execute — submit ACPMessage; if payload maps to GitHub issue flow, Worker forwards to container and returns forwarding status
- GET /acp/status — debug sessions

See `contracts/openapi.yaml` for the OpenAPI shapes and schemas.

Constitution re-check: design keeps feature as a focused library, includes contract tests (to add next), and preserves observability requirements.

---

## Phase 2 (task planning approach — description only)
What `/tasks` must produce (summary):
- Contract test tasks (one per OpenAPI operation) — mark as failing tests
- Durable Object schema + migration tasks
- Session and queue DO implementation tasks
- Authorization mapping UI/API tasks
- Container forwarding integration tests (mock container responses)
- Integration tests for fallback behavior when ACP unavailable

Estimated total tasks: 20–30. They will be ordered to follow TDD (contracts first, then DO models, then services, then integration tests).

---

## Outputs (file paths)
- Implementation plan: `/Users/duwm/Documents/LumiLink/claudecode-modern-container/specs/001-title-integrate-zed/plan.md` (this file)
- Research: `/Users/duwm/Documents/LumiLink/claudecode-modern-container/specs/001-title-integrate-zed/research.md`
- Data model: `/Users/duwm/Documents/LumiLink/claudecode-modern-container/specs/001-title-integrate-zed/data-model.md`
- Quickstart: `/Users/duwm/Documents/LumiLink/claudecode-modern-container/specs/001-title-integrate-zed/quickstart.md`
- Contracts: `/Users/duwm/Documents/LumiLink/claudecode-modern-container/specs/001-title-integrate-zed/contracts/openapi.yaml`

---

If you want, I'll now:
- Generate failing contract tests (Phase 1, TDD) and place them under `test/contract/` (recommended next step), or
- Create Durable Object skeletons and wire the session/queue DOs into the Worker (bigger change).
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