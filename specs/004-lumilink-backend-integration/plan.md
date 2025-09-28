
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

## Repo alignment: lumilink-be (main)

This plan is now concretely mapped to the current lumilink-be repository on main.

- Runtime and router
   - OpenAPIHono router at `src/index.ts` with route registrations via `app.route(...)` and Swagger UI at `/docs`.
   - Global CORS + `agentsMiddleware()`.
   - Scheduled handlers, Cloudflare Queues integration (generic queue + DLQ), and SigNoz tracing instrumentation.
- Durable Objects and bindings
   - Existing DOs: `MyChat`, `ToolCapabilityV2DO`, `NotificationWebSocketDO`, `PendingFilesDO`.
   - D1 database bound as `DB`, Vectorize, R2, KV, Queues producers/consumers.
- Services layer
   - Rich service set under `src/services/*` (queue, notifications, MCP, knowledge, tracing, user notifications, etc.).
- Prisma/D1
   - `prisma/schema.prisma` with extensive models (User, Projects, ChatSession, UserNotification, MemoryRecord, etc.) and Makefile/Wrangler-driven migration flow.
- Configuration
   - `wrangler.toml` defines bindings, queues, crons, migrations (DO storage migration tags), and AI proxy routing.

Implication: ACP integration should be implemented with minimal disruption by adding one route module, one service, one durable object for live session state, and a small Prisma extension for audit trails.

## Implementation touchpoints in lumilink-be

Create or modify the following files in lumilink-be (fresh branch from main):

1. Router and routes
    - Add new route module: `src/route/acp.ts`
       - Endpoints:
          - `POST /acp/session/new`
          - `POST /acp/session/prompt`
          - `POST /acp/session/cancel`
          - `GET  /acp/health`
       - Responsibilities: validate input, delegate to `AcpBridgeService`, attach OpenAPI docs via zod-openapi.
    - Register in `src/index.ts`:
       - `import acp from "./route/acp";`
       - `app.route("/acp", acp);`

2. Service layer
    - Add `src/services/acp-bridge.service.ts`
       - Bridge lumilink-be Worker to Claude Code container ACP runtime.
       - Contract: methods `createSession()`, `sendPrompt()`, `cancelSession()`, returning `ACPSessionResult` envelope (see contracts).
       - Enforce skip rules, capacity checks, diagnostics, and GitHub automation embedding into `githubAutomation`.

3. Durable Object (live session state)
    - Add `src/durable-objects/acp-connection-do.ts` (class `AcpConnectionDO`).
       - Tracks connection state, rolling success window, last heartbeat, and rollback triggers per workspace/session.
       - Emits structured logs: `[ACP]`, `[ROLLBACK]`, `[CAPACITY]`.
    - Update `wrangler.toml`:
       - Add binding: `[[durable_objects.bindings]] name = "ACP_CONNECTION" class_name = "AcpConnectionDO"`
       - Add new migration tag (e.g., `v8`) with `new_sqlite_classes = ["AcpConnectionDO"]`.

4. Prisma/D1 (persistent audit)
    - Extend `prisma/schema.prisma` with minimal tables:
       - `ProtocolMigrationLog` (audit ACP↔HTTP migrations)
       - `AutomationRun` (GitHubAutomationSummary-like record for session runs)
       - `CapacityAlert` (optional, or derive from logs)
    - Follow README/Makefile flow to generate and apply SQL migrations (remember to remove any `_cf_METADATA` drop statements in generated SQL).

5. Notifications
    - Reuse existing services:
       - `src/services/user-notification.service.ts` for persistent inbox (`UserNotification` table)
       - `src/services/websocket-notification.service.ts` + `NotificationWebSocketDO` for real-time toasts
    - ACP integration uses these to emit skip/rollback/recovery toasts and transcript notes (see `contracts/notifications.md`).

6. Queues and telemetry
    - Prefer synchronous path for ACP session RPC; use `QueueService` only for background tasks (e.g., heavy indexing) if needed.
    - Keep structured logs within 32KB limits; head-sampled tracing via `TracingService` remains enabled.

7. Tests (match repo layout)
    - Unit tests: `tests/unit/acp-bridge.service.test.ts`
    - Integration tests: `tests/integration/acp-route.test.ts` covering happy path, skip, rollback trigger, capacity alerts.
    - Consolidated scenarios: `tests/consolidated/` optional end-to-end including WebSocket toast check.

Assumptions (low-risk):
- New code follows current linting, zod-openapi style, vitest harness.
- GitHub credentials provided via existing secret/config pattern; no new secret storage.

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
├── index.ts                         # OpenAPIHono router; register /acp route
├── route/
│   ├── acp.ts                       # NEW: ACP endpoints (new/prompt/cancel/health)
│   └── ...                          # existing routes
├── services/
│   ├── acp-bridge.service.ts        # NEW: Bridge to Claude Code container
│   └── ...                          # existing services reused (notifications, queue, tracing)
└── durable-objects/
   ├── acp-connection-do.ts         # NEW: live ACP session state + rolling metrics
   └── ...                          # existing DOs

prisma/
└── schema.prisma                    # Extend with ProtocolMigrationLog, AutomationRun

wrangler.toml                        # Add DO binding + migration tag (v8)

tests/
├── unit/
│   └── acp-bridge.service.test.ts
├── integration/
│   └── acp-route.test.ts
└── consolidated/
   └── acp-e2e.test.ts (optional)
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
   - Worker side (lumilink-be): Add `tests/integration/acp-route.test.ts` asserting ACP result schema and rollback triggers (fail pending implementation).
   - Service side (lumilink-be): Add `tests/unit/acp-bridge.service.test.ts` verifying skip payloads and rollback decisions (fail initially).

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

**Estimated Output**: 22-28 ordered tasks in `tasks.md`, grouped by lumilink-be changes (routes/services/DO), Prisma migrations, wrangler updates, observability, and tests aligned to `tests/*` structure.

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
