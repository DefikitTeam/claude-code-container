# Implementation Plan: LumiLink-BE ACP Protocol Integration

**Branch**: `002-integrate-lumilink-be` | **Date**: September 17, 2025 |
**Spec**:
[LumiLink-BE ACP Protocol Integration](../002-integrate-lumilink-be/spec.md)
**Input**: Feature specification from `/specs/002-integrate-lumilink-be/spec.md`

## Summary

This implementation replaces LumiLink-BE's HTTP-based communication with Claude
Code containers with the more efficient Application Communication Protocol
(ACP). The integration will establish persistent bidirectional ACP connections
for container operations, resulting in better performance, real-time status
updates, and enhanced reliability while maintaining compatibility with existing
container management functionality.

## Technical Context

**Language/Version**: TypeScript 5.9 running on Node.js 20+ via Cloudflare
Workers  
**Primary Dependencies**:

- Hono 4.7+ (API framework)
- Prisma 5.22+ with D1 adapter (Database)
- @defikitteam/claude-acp-client (new ACP client package)
- @zed-industries/agent-client-protocol (ACP protocol definitions)

# Implementation Plan: LumiLink-BE ACP Protocol Integration

**Branch**: `002-integrate-lumilink-be` | **Date**: September 25, 2025 |
**Spec**:
[LumiLink-BE ACP Protocol Integration](../002-integrate-lumilink-be/spec.md)
**Input**: Feature specification from `/specs/002-integrate-lumilink-be/spec.md`

> _Note_: `.specify/scripts/bash/setup-plan.sh --json` is not present in the
> repository. Planning artifacts therefore reuse the existing `specs/002-…`
> directory and explicit paths gathered manually.

## Summary

Re-enable automated GitHub issue and pull-request generation inside the ACP
container workflow so LumiLink-BE can drive code changes through the
`session/prompt` path. The plan stitches together existing Worker Durable
Objects, the container `PromptProcessor`, and GitHub helper utilities, drawing
on prior `process_issue` implementations in repository history. Success means an
ACP session that produces the same GitHub artifacts the legacy HTTP flow
created, with clear logging, tests, and fallbacks.

## Technical Context

**Languages**:

- Worker: TypeScript 5.8 targeting Cloudflare Workers (Node 22 runtime)
- Container: TypeScript 5.9 compiled to ESM for Node 22 containers

**Key Dependencies**:

- `hono@4.8.2` – Worker routing in `src/index.ts`
- `@cloudflare/containers` – container lifecycle bindings
- `@anthropic-ai/claude-code` – Claude streaming in both worker & container
- `@octokit/rest@22` – GitHub REST client
- `simple-git` – filesystem git orchestration in Worker layer
- Container services: `GitService`, `WorkspaceService`, `PromptProcessor`

**Runtime Architecture**:

- Request hits Worker `src/acp-bridge.ts` → Durable Object → container HTTP
  server (`container_src/src/http-server.ts`).
- Container `session/prompt` handler relies on `PromptProcessor` and
  `GitService` but currently only logs summaries.
- GitHub credentials arrive via `/config` Durable Object and are passed to the
  container through session payloads.

**Constraints**:

- Must keep ACP streaming responsive (<2s added latency vs current summary run)
- Worker execution limited by Cloudflare DO CPU (50ms average budget)
- Container runs inside isolated filesystem; use shallow clones (`--depth 1`)
- Secrets must remain ephemeral (no writing tokens to disk)

**Testing & Tooling**:

- `vitest` in both root and `container_src`
- Custom tests located under `container_src/test/*`
- Manual smoke via `npm run build` + Worker dev server

## Constitution Check

_Gate: ensure we adhere to project guardrails before research._

**Simplicity**

- Single Worker + container project; no new sub-projects introduced
- Reuse existing services instead of new abstraction layers
- No new storage models beyond existing `WorkspaceService`

**Architecture**

- Feature delivered as enhancements to existing modules (`PromptProcessor`,
  `GitService`, worker endpoints)
- Any new helper will live under `container_src/src/services/github/…` with ESM
  exports and JSDoc docs
- No additional CLIs required

**Testing**

- Follow RED→GREEN workflow via Vitest
- Add integration tests beside `container_src/test` to cover GitHub automation
- Worker-level tests extend `test/agent-communication` harness where possible

**Observability**

- Extend `[PROMPT]` logging with structured GitHub automation events
- Capture Git operations in `logs` array returned to worker

**Versioning**

- Continue semantic `BUILD` increments through Git tags (document in plan)
- Maintain backwards-compatible response schema additions only

Initial constitution guard passes with noted testing/logging commitments.

## Project Structure

### Documentation Artifacts

```
specs/002-integrate-lumilink-be/
├── plan.md              # This plan (updated)
├── research.md          # Phase 0: protocol & automation findings
├── data-model.md        # Phase 1: ACP session + GitHub entity updates
├── quickstart.md        # Phase 1: local verification recipe
└── contracts/           # Phase 1: ACP <-> GitHub message contracts
    ├── acp-session-result.json
    ├── github-automation.json
    └── migration-notes.md
```

### Source Code Touchpoints

```
src/
├── index.ts                 # Worker routes; propagates ACP responses
├── acp-bridge.ts            # Worker → container bridge (session/prompt)
└── types.ts                 # Shared request/response types

container_src/src/
├── http-server.ts           # JSON-RPC surface, logging
├── handlers/session-prompt-handler.ts
├── services/prompt/prompt-processor.ts
├── services/git/git-service.ts
├── services/github/         # NEW: GitHub automation helpers
│   ├── github-automation.ts # orchestrate git & Octokit
│   └── templates/           # optional PR body templates
└── services/workspace/workspace-service.ts

test/
├── auth/github-utils.test.ts
└── agent-communication/
    └── claude-code/         # Worker ↔ container integration harness

container_src/test/
├── prompt-processor.test.ts
└── claude-client-cancellation.test.ts
```

## Phase 0: Outline & Research

1. **Historical Analysis**
   - Inspect commits tagged around pre-ACP automation (e.g. `main@2024-08`,
     branch `legacy-http-flow`) to recover `process_issue` behavior and PR
     heuristics.
   - Document differences in container entry points (HTTP `/process-issue` vs
     ACP `session/prompt`).

2. **Credential Flow Audit**
   - Trace `/config` storage → Durable Objects → container parameters to ensure
     installation tokens/API keys reach automation layer.
   - Verify secrets remain in-memory.

3. **Git Workspace Constraints**
   - Confirm `WorkspaceService` workspace path permissions and disk quotas.
   - Evaluate impact of shallow clones vs current `GitService.ensureRepo`.

4. **Tooling Survey**
   - Evaluate whether to reuse `simple-git` in container or rely on native git
     CLI already wrapped by `GitService`.
   - Review Octokit usage patterns in `src/index.ts` for reference.

5. **Outcome**
   - Capture findings & clarifications (performance targets, max concurrency,
     fallback strategy) in `research.md` with decision matrices.

## Phase 1: Design & Contracts

1. **Interaction Design**
   - Define when automation triggers (e.g. Claude summary detects structured
     plan vs explicit user request) and express as a state machine in
     `data-model.md`.
   - Specify new `GitHubAutomationResult` object appended to
     `SessionPromptResponse.result` (optional, read-only).

2. **Module Design**
   - Draft `GitHubAutomationService` interface with methods: `detectIntent`,
     `prepareWorkspace`, `commitChanges`, `openPullRequest`.
   - Map dependencies (GitService, Octokit wrapper, config payload) and define
     injection strategy via `PromptProcessor` constructor options.

3. **Contracts & Schemas**
   - Update `/contracts/github-automation.json` to cover
     - branch naming convention (e.g. `acp/{sessionId}`)
     - commit message template
     - PR body template referencing Claude summary
   - Document response shape addition in `acp-session-result.json`.

4. **Testing Strategy**
   - Specify integration test scenarios in `quickstart.md` (mock Octokit to
     avoid live calls, assert branch creation path invoked).
   - Add unit-test plans for detection heuristics and error handling.

5. **Security & Fallback**
   - Design fail-closed paths: on Octokit failure, attach diagnostic to response
     without raising fatal error; ensure summary still returns.
   - Document cleanup (discard workspace on failure).

Deliver Phase 1 outputs:

- Updated `data-model.md`
- New/updated contracts in `contracts/`
- Expanded `research.md`
- Refreshed `quickstart.md` walkthrough for validating automation end-to-end

## Phase 2: Task Planning

1. **Dependency Graph**

   ```
   A. GitHub Automation Module
      └─ depends on research decisions & contracts

   B. Prompt Processor integration
      └─ depends on A + updated response contracts

   C. Worker propagation & logging
      └─ depends on B (makes new fields visible)

   D. Tests (unit + integration)
      └─ depend on A/B/C scaffolding

   E. Fallback & telemetry hardening
      └─ depends on A/B instrumentation
   ```

2. **Task Breakdown (for `/tasks`)**
   1. Recover legacy automation details (diff prior commit, document in
      research).
   2. Implement `GitHubAutomationService` with detection + staged operations.
   3. Extend `PromptProcessor` to call automation when session criteria met.
   4. Add Worker-side propagation of automation results and update Durable
      Object logging.
   5. Write container integration tests mocking Octokit + git CLI.
   6. Provide quickstart instructions & sample config for manual verification.
   7. Harden error/fallback paths and emit structured logs (`[GITHUB-AUTO]`).

3. **Testing Plan**
   - **Unit**: automation intent detection, PR formatting, branch naming
   - **Integration**: end-to-end container run with mocked Octokit verifying PR
     payload captured
   - **Smoke**: Worker `/acp/session/prompt` call verifying JSON response
     includes automation section
   - **Performance**: ensure automation adds <5s for typical repo by using
     shallow clone and chunked logging

4. **Milestones**
   - M1: Historical diff reviewed, research updated
   - M2: Automation service skeleton + contracts merged
   - M3: PromptProcessor integration with feature flag
   - M4: Worker propagation and logging updates
   - M5: Tests passing, quickstart validated
   - M6: Rollout toggle in place (env flag or config)

## Phase 3+: Future Implementation

- Phase 3 (`/tasks`): generate ordered task list from above breakdown
- Phase 4: feature implementation following tasks & TDD
- Phase 5: validation (tests, manual quickstart, performance sampling)

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
| _None_    | —          | —                                    |

## Progress Tracking

**Phase Status**

- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**

- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [ ] All NEEDS CLARIFICATION resolved (pending performance target confirmation)
- [ ] Complexity deviations documented (none currently)

---

_Based on Constitution draft in `/memory/constitution.md`_ Task: "Find best
practices for {tech} in {domain}"

```

3. **Consolidate findings** in `research.md` using format:
- Decision: [what was chosen]
- Rationale: [why chosen]
- Alternatives considered: [what else evaluated]

**Output**: research.md with all NEEDS CLARIFICATION resolved

## Phase 1: Design & Contracts

_Prerequisites: research.md complete_

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

**Output**: data-model.md, /contracts/\*, failing tests, quickstart.md,
agent-specific file

## Phase 2: Task Planning Approach

_This section describes what the /tasks command will do - DO NOT execute during
/plan_

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

_These phases are beyond the scope of the /plan command_

**Phase 3**: Task execution (/tasks command creates tasks.md)
**Phase 4**: Implementation (execute tasks.md following constitutional
principles)
**Phase 5**: Validation (run tests, execute quickstart.md, performance
validation)

## Complexity Tracking

_Fill ONLY if Constitution Check has violations that must be justified_

| Violation                  | Why Needed         | Simpler Alternative Rejected Because |
| -------------------------- | ------------------ | ------------------------------------ |
| [e.g., 4th project]        | [current need]     | [why 3 projects insufficient]        |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient]  |

## Progress Tracking

_This checklist is updated during execution flow_

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

_Based on Constitution v2.1.1 - See `/memory/constitution.md`_
```
