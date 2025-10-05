
# Implementation Plan: Multi-project registrations under a shared GitHub installation

**Branch**: `005-support-multiple-user` | **Date**: 2025-10-06 | **Spec**: `/specs/005-support-multiple-user/spec.md`
**Input**: Feature specification from `/specs/005-support-multiple-user/spec.md`

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
Enable multiple active user registrations to coexist under the same GitHub App installation by storing registration records as a list per installation, preserving backward compatibility, and requiring explicit disambiguation when resolving a specific registration.

## Technical Context
**Language/Version**: TypeScript (Cloudflare Workers runtime)  
**Primary Dependencies**: Hono router, Cloudflare Durable Objects, project crypto utilities  
**Storage**: Durable Object storage (key-value) with AES-256-GCM encrypted secrets  
**Testing**: Vitest unit tests for workers and container utilities  
**Target Platform**: Cloudflare Workers + Durable Objects deployment  
**Project Type**: Single backend worker with supporting container services  
**Performance Goals**: Maintain existing registration latency (<1s) while supporting O(10) registrations per installation without noticeable degradation  
**Constraints**: Must remain backward compatible with existing single-registration workers; no additional external storage or secrets  
**Scale/Scope**: Anticipate each installation supporting up to ~10 concurrent project registrations initially, scalable with DO storage limits

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Initial review: constitution document contains only placeholders, so no binding principles are defined. Proceeding under existing team norms with emphasis on documentation and TDD.

Post-design review: Phase 1 outputs remain consistent with team norms; no deviations identified.

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
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->
directories captured above]
```
src/
├── index.ts                 # Worker routing (GitHub endpoints, user registration)
├── user-endpoints.ts        # Register-user handler to be updated
├── user-config-do.ts        # Durable Object storing registrations and installation index
├── types.ts                 # Shared type definitions for API payloads
└── ...

test/
├── auth/
│   ├── github-utils.test.ts
│   └── token-manager.test.ts
└── user-config/
   └── (new) user-config-do.test.ts (planned)

docs/
└── README.md (update endpoint documentation as needed)
```

**Structure Decision**: Single worker-centric project; changes concentrated in `src/user-config-do.ts`, `src/user-endpoints.ts`, `src/index.ts`, corresponding tests under `test/`.

## Phase 0: Outline & Research
1. Confirm migration strategy for existing single-registration entries and the installation lookup index.
2. Evaluate conflict resolution policies when no `userId` is supplied in follow-up API calls.
3. Identify testing approach for concurrent registrations to ensure Durable Object isolation.

**Output**: `research.md` capturing migration plan, disambiguation policy, and concurrency testing strategy.

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. Document revised `RegistrationRecord` schema and installation index structure in `data-model.md`, noting encryption handling and timestamps.
2. Produce REST contract updates in `/contracts/registration-resolution.md` covering registration creation, list by installation, and resolution behavior when `userId` absent.
3. Define planned test surfaces (unit test suite for Durable Object behavior, integration tests for `/register-user`) in `quickstart.md` to guide validation.
4. Run `.specify/scripts/bash/update-agent-context.sh copilot` to capture new context after Phase 1 outputs are generated.

**Output**: `data-model.md`, `/contracts/registration-resolution.md`, `quickstart.md`, agent context update log.

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Load `.specify/templates/tasks-template.md` as base.
- Derive tasks from Phase 1 artifacts: migration + storage updates (data-model), API contract adjustments, validation flows (quickstart).
- Each contract scenario → failing contract/unit test task [P].
- Each entity change → storage migration + persistence task [P].
- Each acceptance scenario → integration test task preceding implementation work.

**Ordering Strategy**:
- Begin with storage schema migration tasks, followed by Durable Object logic updates, then worker endpoint adjustments, and finally documentation updates.
- Maintain TDD by writing/updating tests before modifying production code.
- Mark documentation and cleanup tasks as parallelizable where dependencies allow.

**Estimated Output**: ~20-25 ordered tasks in `tasks.md`.

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan.

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
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [ ] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [ ] Complexity deviations documented

---
*Based on Constitution v2.1.1 - See `/memory/constitution.md`*
