
# Implementation Plan: LumiLink Backend ACP Integration

**Branch**: `004-lumilink-backend-integration` | **Date**: September 26, 2025 | **Spec**: [/Users/duwm/Documents/LumiLink/claudecode-modern-container/specs/004-lumilink-backend-integration/spec.md]
**Input**: Feature specification from `/specs/004-lumilink-backend-integration/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from file system structure or context (web=frontend+backend, mobile=app+api)
   → Set Structure Decision based on project type
3. Fill the Constitution Check section based on the content of the constitution document.
4. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
5. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
6. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, `GEMINI.md` for Gemini CLI, `QWEN.md` for Qwen Code or `AGENTS.md` for opencode).
7. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
8. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
9. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary
LumiLink-BE must switch container communications to the ACP protocol while preserving GitHub automation outputs and providing richer operational visibility. Success means ACP becomes the default session transport, HTTP remains a guarded fallback with automated rollback when ACP success dips below 99% for an hour, users receive real-time toast + transcript notices whenever automation is skipped, and operations teams gain telemetry on capacity, error categories, and automation effectiveness.

## Scope & Exclusions
- In scope (Backend only): Cloudflare Worker routes and ACP bridge, Durable Objects, container services (handlers, GitHub automation, workspace, diagnostics), schemas/contracts, and backend tests/integration harnesses.
- Out of scope (Frontend implementation): UI component work to render toasts or transcript entries. This plan only defines the notification payload contracts the frontend consumes. Any UI changes will be planned and tracked separately under a frontend feature.

## Technical Context
**Language/Version**: TypeScript 5.x targeting Cloudflare Workers (Node 18 runtime) and Node.js 20 for container services  
**Primary Dependencies**: Hono router, Cloudflare Durable Objects, `@cloudflare/containers`, `@anthropic-ai/claude-code`, `@octokit/rest`, `simple-git`  
**Storage**: Durable Objects + KV (configuration and token caches); ephemeral container workspace on `/tmp`  
**Testing**: Vitest suites in both root and `container_src`, custom integration harness under `test/agent-communication`  
**Target Platform**: Cloudflare Worker entrypoint bridging to managed container runtime  
**Project Type**: Dual runtime (worker + container) managed inside monorepo (treat as single project with shared types)  
**Performance Goals**: ≥50% latency reduction per request, ≥30% throughput improvement vs HTTP baseline, ACP uptime ≥99.5%  
**Constraints**: Auto rollback when ACP success <99% in 1-hour window, maintain GitHub artifact parity, avoid secret persistence, shallow clones only  
**Scale/Scope**: Support 1,000 concurrent ACP sessions per worker with alerting before limits, multi-tenant installations across LumiLink customers

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The current constitution placeholder lacks concrete rules, so we interpret core guardrails from repository conventions: keep worker/container boundary intact, preserve TDD (existing Vitest suites), favour simplicity by reusing token manager and workspace services, and ensure logging/observability enhancements accompany new behaviour. No violations identified; document updates will reference these expectations.

## Project Structure

### Documentation (this feature)
```
specs/004-lumilink-backend-integration/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
│   ├── github-automation.json
│   ├── acp-session-result.json
│   └── notifications.md
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (repository root)
```
src/
├── index.ts                # Worker router and ACP bridge entry
├── acp-bridge.ts           # Worker ↔ container JSON-RPC bridge
├── durable-objects.ts      # DO definitions including ACP session store
├── token-manager.ts        # Installation token refresh logic
├── types.ts                # Shared request/response contracts
└── ...                     # Supporting auth/config utilities

container_src/
├── src/
│   ├── handlers/           # session-new, session-prompt, cancel handlers
│   ├── services/
│   │   ├── github/         # automation helpers (to be extended)
│   │   ├── workspace/      # repo cloning + cleanup
│   │   └── claude/         # ACP/Claude orchestration
│   ├── core/               # protocol types, diagnostics, prompts
│   └── tools.ts
├── test/                   # Vitest suites for cancellation, prompts, automation
└── package.json

test/
├── acp-bridge.test.ts
└── agent-communication/    # End-to-end Worker↔container harness
```

**Structure Decision**: Dual-runtime monorepo retaining existing `src/` (worker) and `container_src/` (container) hierarchies; Phase 1 outputs will extend services within these directories and add contracts/tests alongside existing suites.

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

**Output**: research.md with all NEEDS CLARIFICATION resolved (performance instrumentation, capacity management, GitHub fallback strategy, observability scope)

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Extract entities from feature spec** → `data-model.md`:
   - Document ACPConnectionRecord, ProtocolMigrationLog, GitHubAutomationSummary, CapacityAlert with relationships to Durable Objects and session payloads
   - Capture lifecycle transitions (connected → error → reconnect, rollback triggers)

2. **Generate API/contract surfaces** → `/contracts/`:
   - Update `acp-session-result.json` to include `githubAutomation`, toast skip metadata, and rollback indicators
   - Refresh `github-automation.json` to capture new diagnostics, skip reasons, and capacity alerts
   - Add `notifications.md` describing UI messaging and telemetry pipelines for toasts/transcript entries

3. **Design failing contract tests**:
   - Worker side: Extend `test/agent-communication` harness to assert ACP result schema additions and rollback triggers (tests fail pending implementation)
   - Container side: Add Vitest cases to `container_src/test/github-automation.service.test.ts` verifying skip notification payloads and rollback decisions (fail initially)

4. **Extract integration scenarios** → `quickstart.md`:
   - Map user stories to manual validation flows (ACP default session start, HTTP fallback, toast notification path, audit log review)
   - Include steps for forcing <99% success scenario and verifying automatic rollback

5. **Update agent file**:
   - Run `/.specify/scripts/bash/update-agent-context.sh copilot` to record new dependencies (ACP monitoring, toast UX expectations) while respecting existing manual entries

**Output**: data-model.md, contracts artifacts, quickstart.md, and updated agent guidance with failing tests capturing new behaviour expectations

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Load `.specify/templates/tasks-template.md` as base
- Derive tasks from Phase 1 artifacts: 
   - Contracts → extend JSON schemas + failing tests
   - Entities → worker/container persistence updates and DO schema revisions
   - Quickstart flows → integration smoke tasks for ACP default, rollback, skip notification
- Ensure automation logging, observability, and capacity alerting each receive dedicated work items

**Ordering Strategy**:
- TDD first: add/extend failing tests (worker integration, container service, telemetry) before implementing functionality
- Sequencing: schema/data model changes → worker bridge updates → container services (GitHub automation, workspace handling) → monitoring/alerting hooks → UX messaging
- Mark [P] for standalone efforts (documentation updates, analytics dashboards) while keeping protocol and automation work serialized

**Estimated Output**: 22-28 ordered tasks in `tasks.md`, grouped by schema, runtime behaviour, UX/observability, and validation suites

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
No constitution deviations identified; no additional justification required.


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [x] Complexity deviations documented

---
*Based on Constitution v2.1.1 - See `/memory/constitution.md`*
