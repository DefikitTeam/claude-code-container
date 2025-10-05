# Tasks: Multi-project registrations under a shared GitHub installation

**Input**: Design documents from `/specs/005-support-multiple-user/`
**Prerequisites**: plan.md (required), research.md, data-model.md, contracts/

## Phase 3.1: Setup
- [ ] T001 Verify branch `005-support-multiple-user` is checked out, workspace is clean, and dependencies are installed (`npm install`) at repo root.
- [ ] T002 Run baseline test suite (`npm test`) to capture current failures before introducing multi-registration changes.

## Phase 3.2: Tests First (TDD) ⚠️ MUST COMPLETE BEFORE 3.3
- [ ] T003 [P] Add failing Durable Object unit tests covering multi-registration storage, migration, and removal flows in `test/user-config/user-config-do.test.ts`.
- [ ] T004 [P] Add failing endpoint tests for POST `/register-user` verifying additional registrations and `existingRegistrations` payload in `test/user/register-user.endpoint.test.ts`.
- [ ] T005 [P] Add failing endpoint tests for GET `/github/repositories` requiring `userId` and returning 409 guidance when omitted in `test/github/repositories.endpoint.test.ts`.
- [ ] T006 [P] Add failing endpoint tests for GET/DELETE `/user-config/:userId` ensuring the installation directory updates correctly in `test/user/user-config.endpoint.test.ts`.
- [ ] T007 [P] Add failing integration test covering the quickstart flow (register two projects, conflict on missing userId, cleanup) in `test/integration/register-user-multi.test.ts`.

## Phase 3.3: Core Implementation (ONLY after tests are failing)
- [ ] T008 Update shared types in `src/types.ts` to reflect multi-registration responses (new fields like `existingRegistrations`, optional `projectLabel`).
- [ ] T009 Refactor `src/user-config-do.ts` to store multiple `RegistrationRecord`s per installation, including in-place migration for legacy entries and directory maintenance.
- [ ] T010 Update Durable Object route handlers in `src/user-config-do.ts` to expose the new directory payloads used by worker endpoints.
- [ ] T011 Enhance `src/user-endpoints.ts` to accept optional `projectLabel`, return `existingRegistrations`, and surface conflict responses required by the tests.
- [ ] T012 Adjust worker GitHub endpoints in `src/index.ts` (and related helpers if needed) to require `userId` disambiguation or return the 409 conflict guidance payload.

## Phase 3.4: Integration & Validation
- [ ] T013 Ensure any supporting helper modules (e.g., `src/github-utils.ts` or config resolution utilities) correctly pass `userId`/`installationId` combinations and handle conflict errors.
- [ ] T014 [P] Update documentation (`README.md` and any relevant docs under `docs/`) to describe multi-registration setup, conflict behavior, and new request parameters.

## Phase 3.5: Polish & Verification
- [ ] T015 [P] Refresh operational quickstart instructions in `specs/005-support-multiple-user/quickstart.md` (and any deployment runbooks) with verified command outputs after implementation.
- [ ] T016 Run full test suite (`npm test`) and document results, ensuring new tests pass and no regressions remain.

## Dependencies
- T001 → T002 (environment ready before baseline).
- T002 → T003-T007 (establish baseline before writing failing tests).
- T003-T007 must all complete (tests failing) before T008-T012.
- T008 → T009 (type updates before DO refactor).
- T009 → T010 (storage changes before handler updates).
- T010 → T011 (handlers before endpoint uses).
- T011 → T012 (registration responses before GitHub endpoint enforcement).
- T012 → T013 (ensure helpers align with new endpoint contracts).
- Documentation and polish tasks (T014-T016) follow successful core implementation.

## Parallel Execution Example
```
# After completing T002, create failing tests in parallel:
/run_task "T003 Add failing DO unit tests in test/user-config/user-config-do.test.ts"
/run_task "T004 Add failing POST /register-user endpoint tests in test/user/register-user.endpoint.test.ts"
/run_task "T005 Add failing GET /github/repositories tests in test/github/repositories.endpoint.test.ts"
/run_task "T006 Add failing user-config endpoint tests in test/user/user-config.endpoint.test.ts"
/run_task "T007 Add failing integration test in test/integration/register-user-multi.test.ts"
```

## Notes
- Maintain TDD discipline: do not implement storage or endpoint changes until new tests fail.
- When refactoring Durable Object storage, ensure encrypted fields remain untouched and migration preserves legacy data.
- Conflicts must provide user-friendly guidance listing available registrations as documented in the contracts.
