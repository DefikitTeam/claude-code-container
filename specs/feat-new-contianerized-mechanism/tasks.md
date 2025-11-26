# Tasks: Migrate to Daytona Sandboxes

**Input**: Design documents from `/specs/feat-new-contianerized-mechanism/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅

**Tests**: Unit and integration tests are included as this is a critical infrastructure migration.

**Organization**: Tasks organized by user scenario from spec.md to enable independent implementation and testing.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user scenario this task belongs to (USA = Scenario A: Agent Execution, USB = Scenario B: Long-Running Task)
- Include exact file paths in descriptions

## Path Conventions

- **Worker Layer**: `src/` (Cloudflare Worker)
- **Container Layer**: `container_src/` (unchanged - runs in Daytona)
- **Config**: Root level (`wrangler.jsonc`)
- **Tests**: `src/test/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: SDK installation and configuration.

- [ ] T001 Add `@daytonaio/sdk` package to root package.json dependencies
- [ ] T002 [P] Add Daytona environment variables to `wrangler.jsonc` vars section (`USE_DAYTONA_SANDBOXES`, `DAYTONA_API_KEY`)
- [ ] T003 [P] Update `.dev.vars.example` with Daytona credentials template
- [ ] T004 Verify Daytona SDK works in Cloudflare Worker environment with nodejs_compat flag

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core interfaces and error types that ALL user scenarios depend on.

**⚠️ CRITICAL**: No user scenario work can begin until this phase is complete.

- [ ] T005 Create Daytona error types in `src/shared/errors/daytona.errors.ts` (DaytonaSandboxError class with DaytonaErrorCode enum)
- [ ] T006 [P] Define `IDaytonaSandboxService` interface in `src/core/interfaces/services/daytona-sandbox.service.ts`
- [ ] T007 [P] Export new interface from `src/core/interfaces/services/index.ts`
- [ ] T008 Add Daytona types (`SandboxConfig`, `SandboxInfo`, `SandboxStatus`) to `src/shared/types/daytona.types.ts`
- [ ] T009 Update `src/index.ts` Env interface with Daytona environment variables (`DAYTONA_API_KEY`, `USE_DAYTONA_SANDBOXES`)

**Checkpoint**: Foundation ready - user scenario implementation can now begin in parallel.

---

## Phase 3: User Scenario A - Agent Execution Request (Priority: P1) 🎯 MVP

**Goal**: System can create a Daytona sandbox, upload code, and execute it.

**Independent Test**: `curl POST /api/agent/execute` results in a successful command execution in a new sandbox.

### Tests for User Scenario A

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [ ] T010 [P] [USA] Unit test for DaytonaSandboxService `create` method in `src/test/daytona-sandbox.service.test.ts`
- [ ] T011 [P] [USA] Unit test for DaytonaSandboxService `executeCommand` method in `src/test/daytona-sandbox.service.test.ts`
- [ ] T012 [P] [USA] Unit test for DaytonaSandboxService `delete` method in `src/test/daytona-sandbox.service.test.ts`
- [ ] T013 [P] [USA] Unit test for DaytonaSandboxService `getStatus` method in `src/test/daytona-sandbox.service.test.ts`
- [ ] T014 [USA] Integration test for sandbox lifecycle (create → execute → delete) in `src/test/daytona-sandbox.integration.test.ts`

### Implementation for User Scenario A

- [ ] T015 [USA] Implement `DaytonaSandboxServiceImpl` class skeleton in `src/infrastructure/services/daytona-sandbox.service.impl.ts`
- [ ] T016 [USA] Implement `create()` method using `Daytona.create()` from the SDK.
- [ ] T017 [USA] Implement `getStatus()` method.
- [ ] T018 [USA] Implement `delete()` method using `sandbox.delete()` from the SDK.
- [ ] T019 [USA] Implement `executeCommand()` method using `sandbox.process.executeCommand()`.
- [ ] T020 [USA] Add retry logic with exponential backoff for transient Daytona API errors.
- [ ] T021 [USA] Add structured logging with sandboxId, userId metadata.
- [ ] T022 [USA] Export `DaytonaSandboxServiceImpl` from `src/infrastructure/services/index.ts`.

### DI Wiring for User Scenario A

- [ ] T023 [USA] Add feature flag logic in `src/index.ts` setupDI() to select between ContainerServiceImpl and DaytonaSandboxServiceImpl.
- [ ] T024 [USA] Update relevant UseCases to accept the generic sandbox service interface.

**Checkpoint**: At this point, User Scenario A should be fully functional.

---

## Phase 4: User Scenario B - Long-Running Task (Priority: P2)

**Goal**: Environment remains active for extended tasks (>30s).

**Independent Test**: Execute `npm install` of a large package in a sandbox, verify completion without timeout.

### Tests for User Scenario B

- [ ] T025 [P] [USB] Unit test for configurable sandbox timeout in `src/test/daytona-sandbox.service.test.ts`
- [ ] T026 [P] [USB] Integration test for long command execution (>60s) in `src/test/daytona-sandbox.integration.test.ts`

### Implementation for User Scenario B

- [ ] T027 [USB] Add `timeout` parameter to `create` configuration.
- [ ] T028 [USB] Implement long-running command execution using `sandbox.process.createSession()` and `executeSessionCommand({ async: true })`.
- [ ] T029 [USB] Add logic to handle streaming I/O if available through the SDK for async sessions.

**Checkpoint**: Both user scenarios should now work.

---

## Phase 5: Resource Management & Security (Priority: P3)

**Goal**: Proper termination, timeout handling, and secure credential passing.

**Independent Test**: Sandbox terminates correctly after task, credentials not logged.

### Tests for Resource Management

- [ ] T030 [P] Unit test for environment variable injection (credentials not logged) in `src/test/daytona-sandbox.service.test.ts`
- [ ] T031 [P] Unit test for sandbox cleanup on error in `src/test/daytona-sandbox.service.test.ts`
- [ ] T032 Integration test for timeout enforcement in `src/test/daytona-sandbox.integration.test.ts`

### Implementation for Resource Management

- [ ] T033 Implement secure environment variable passing (filter sensitive from logs).
- [ ] T034 Add automatic sandbox cleanup on uncaught errors/exceptions.
- [ ] T035 Implement per-user sandbox quota tracking (optional, using Durable Object state).
- [ ] T036 Add sandbox metadata tracking (userId, installationId, issueId) for audit.

**Checkpoint**: Resource management complete.

---

## Phase 6: Staging & Validation

**Purpose**: End-to-end validation before production rollout.

- [ ] T037 Deploy to staging environment with `USE_DAYTONA_SANDBOXES=true`
- [ ] T038 [P] Manual test: Execute agent via GitHub issue webhook.
- [ ] T039 [P] Manual test: Verify agent can complete a task (e.g., create a PR).
- [ ] T040 Run load test: 10 concurrent sandbox creations.
- [ ] T041 Review logs for error patterns, latency metrics.
- [ ] T042 Run `quickstart.md` validation steps end-to-end.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, cleanup, and production preparation.

- [ ] T043 [P] Update README.md with Daytona configuration section.
- [ ] T044 [P] Create Daytona runbook in `docs/runbooks/daytona-troubleshooting.md`.
- [ ] T045 [P] Document rollback procedure in `docs/runbooks/daytona-rollback.md`.
- [ ] T046 Add environment variable validation on Worker startup.
- [ ] T047 Code cleanup: Remove any debug logging, add JSDoc comments.
- [ ] T048 [P] Update CLAUDE.md with Daytona architecture notes.
- [ ] T049 Create migration guide for operators in `docs/migration/daytona-migration.md`.

---

## Task Summary

| Phase | Tasks | Parallel | Description |
|-------|-------|----------|-------------|
| 1. Setup | T001-T004 | 2/4 | SDK, config |
| 2. Foundational | T005-T009 | 2/5 | Interfaces, types, errors |
| 3. Scenario A | T010-T024 | 4/15 | Agent execution (MVP) |
| 4. Scenario B | T025-T029 | 2/5 | Long-running tasks |
| 5. Resources | T030-T036 | 2/7 | Cleanup, security |
| 6. Staging | T037-T042 | 2/6 | Validation |
| 7. Polish | T043-T049 | 4/7 | Docs, cleanup |

**Total: 49 tasks**
