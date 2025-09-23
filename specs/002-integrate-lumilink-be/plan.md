# Implementation Plan: LumiLink-BE ACP Protocol Integration

**Branch**: `002-integrate-lumilink-be` | **Date**: September 17, 2025 | **Spec**: [LumiLink-BE ACP Protocol Integration](../002-integrate-lumilink-be/spec.md)
**Input**: Feature specification from `/specs/002-integrate-lumilink-be/spec.md`

## Summary
This implementation replaces LumiLink-BE's HTTP-based communication with Claude Code containers with the more efficient Application Communication Protocol (ACP). The integration will establish persistent bidirectional ACP connections for container operations, resulting in better performance, real-time status updates, and enhanced reliability while maintaining compatibility with existing container management functionality.

## Technical Context
**Language/Version**: TypeScript 5.9 running on Node.js 20+ via Cloudflare Workers  
**Primary Dependencies**: 
- Hono 4.7+ (API framework)
- Prisma 5.22+ with D1 adapter (Database)
- @defikitteam/claude-acp-client (new ACP client package)
- @zed-industries/agent-client-protocol (ACP protocol definitions)  
**Storage**: Prisma with D1 (SQLite) for container configurations and sessions  
**Testing**: Vitest 2.1+ with integration and unit tests  
**Target Platform**: Cloudflare Workers (production), Node.js local dev environment  
**Project Type**: Backend service with API endpoints  
**Performance Goals**: 50%+ reduction in operation latency, 30%+ improvement in throughput  
**Constraints**: 
- Compatible with existing container deployments
- Graceful fallback to HTTP when needed
- Max worker CPU time limits (30s)
- Max connection count based on worker limits  
**Scale/Scope**: Support for 1000+ concurrent container connections

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Simplicity**:
- Projects: 1 (backend service)
- Using framework directly: Yes (Hono + ACP client)
- Single data model: Yes (extending existing Prisma schema)
- Avoiding patterns: Yes (direct service implementation)

**Architecture**:
- EVERY feature as library: Yes (ACP client as separate module)
- Libraries: 
  - acp-client: Handle ACP protocol communication
  - container-services: Container lifecycle management
  - container-communication: Communication protocols (ACP/HTTP)
- CLI: Not applicable (API-based service)
- Library docs: Yes (JSDoc format)

**Testing**:
- RED-GREEN-Refactor cycle enforced: Yes
- Git commits show tests before implementation: Will enforce
- Order: Contract→Integration→E2E→Unit followed: Yes
- Real dependencies used: Yes (actual container integration tests)
- Integration tests for: ACP connections, protocol handling, session management

**Observability**:
- Structured logging included: Yes (extending existing logging)
- Frontend logs → backend: N/A (backend-only implementation)
- Error context sufficient: Yes (detailed ACP error handling)

**Versioning**:
- Version number assigned: 1.0.0 (first ACP implementation)
- BUILD increments on every change: Yes
- Breaking changes handled: Yes (protocol version compatibility layer)

## Project Structure

### Documentation (this feature)
```
specs/002-integrate-lumilink-be/
├── plan.md              # This file
├── research.md          # Phase 0 output (performance targets, protocol details)
├── data-model.md        # Phase 1 output (connection models, schema extensions)
├── quickstart.md        # Phase 1 output (setup guide)
├── contracts/           # Phase 1 output (ACP message schemas)
│   ├── acp-messages.json      # ACP message definitions
│   ├── container-events.json  # Container event schemas
│   └── migration-types.json   # Types for migration
└── tasks.md             # Phase 2 output (NOT created by /plan)
```

### Source Code Integration (lumilink-be repository)
```
src/
├── services/
│   ├── acp-client.service.ts              # NEW: ACP client implementation
│   ├── acp-connection.service.ts          # NEW: Connection management
│   ├── container-communication.service.ts # MODIFIED: Add ACP support
│   ├── container.service.ts               # MODIFIED: Update for ACP
│   ├── container-health-monitor.service.ts # MODIFIED: ACP health monitoring
│   └── container-integration-session.service.ts # MODIFIED: Session with ACP
├── types/
│   ├── acp-connection.types.ts           # NEW: ACP connection types
│   ├── acp-message.types.ts              # NEW: ACP message schemas
│   └── container.types.ts                # MODIFIED: Add ACP fields
├── utils/
│   ├── acp-helpers.ts                    # NEW: ACP utility functions
│   └── container-utils.ts                # MODIFIED: Update utilities
├── middleware/
│   └── acp-auth.middleware.ts            # NEW: ACP authentication
├── route/
│   └── containers.ts                     # MODIFIED: Add ACP routes
└── durable-objects/
    └── acp-connection-do.ts              # NEW: Connection state management
```

**Structure Decision**: This is a backend service integration with the existing lumilink-be structure.

## Phase 0: Outline & Research

1. **Extract unknowns from Technical Context**:
   - Performance targets: Research latency reduction expectations
   - ACP protocol version compatibility: Verify supported versions
   - Maximum concurrent connections: Test connection scaling
   - Container migration strategy: Define approach for existing containers

2. **Generate and dispatch research agents**:
   ```
   Research performance targets for ACP vs HTTP in Cloudflare Workers
   Research ACP protocol specification and versioning
   Research connection scaling in Cloudflare Workers environment
   Find best practices for graceful protocol migration
   Research error handling patterns in bidirectional protocols
   ```

3. **Consolidate findings** in `research.md` using format:
   - Decision: Performance targets of 50%+ latency reduction based on protocol overhead elimination
   - Rationale: HTTP has connection setup/teardown overhead eliminated in persistent connections
   - Alternatives considered: WebSocket bridge considered but rejected as ACP provides better type safety

**Output**: research.md with all NEEDS CLARIFICATION resolved

## Phase 1: Design & Contracts

1. **Extract entities from feature spec** → `data-model.md`:
   - AcpConnection: connection_id, container_id, status, last_active, version
   - ContainerSession (modified): protocol_type, fallback_enabled
   - AcpMessage: message_id, connection_id, type, payload, timestamp
   - Protocol configuration extensions to existing models

2. **Generate API contracts** from functional requirements:
   - Define ACP message schemas in `/contracts/acp-messages.json`
   - Define container event schemas in `/contracts/container-events.json`
   - Define migration types in `/contracts/migration-types.json`

3. **Generate contract tests** from contracts:
   - Test ACP connection establishment
   - Test message format validation
   - Test protocol error handling
   - Test session state consistency

4. **Extract test scenarios** from user stories:
   - Container deployment with ACP connection
   - Real-time status updates via ACP
   - Multiple concurrent container operations
   - Connection failure and recovery
   - Migration from HTTP to ACP protocol

5. **Update agent file incrementally**:
   - Add ACP protocol support to agent context
   - Preserve existing container capabilities
   - Update recent changes to include ACP integration

**Output**: data-model.md, /contracts/*, failing tests, quickstart.md, agent-specific file

## Phase 2: Task Planning

1. **Compute technical graph**:
   ```
   Implementation dependencies:
   1. ACP Client Integration (Core)
      - Install @defikitteam/claude-acp-client
      - Implement connection management
      - Implement message handling
   
   2. Service Layer Adaptation
      - Update container.service.ts
      - Update container-communication.service.ts
      - Create acp-protocol.service.ts
   
   3. Migration Strategy
      - Implement protocol detection
      - Add fallback mechanisms
      - Create migration utilities
   
   4. Testing & Validation
      - Unit tests for ACP client
      - Integration tests for container communication
      - Performance benchmarks
      - Migration tests
   ```

2. **Convert graph to tasks**:

   **Task 1: Core ACP Client Setup**
   - Install @defikitteam/claude-acp-client package
   - Create AcpConnectionManager class
   - Implement connection establishment
   - Implement message serialization/deserialization
   - Add connection lifecycle hooks
   - Add error handling and reconnection logic

   **Task 2: Service Layer Integration**
   - Update container.service.ts to support multiple protocols
   - Update container-communication.service.ts with ACP methods
   - Create acp-protocol.service.ts for protocol-specific logic
   - Add protocol detection logic
   - Implement protocol switching mechanism

   **Task 3: Database Schema Updates**
   - Add AcpConnection entity to Prisma schema
   - Update ContainerSession with protocol field
   - Create migration for schema changes
   - Add database queries for ACP connections

   **Task 4: Container Management Updates**
   - Update container creation to establish ACP connection
   - Add container event listeners for ACP protocol
   - Implement container health monitoring via ACP
   - Update container termination process

   **Task 5: Testing & Validation**
   - Create unit tests for ACP client
   - Create integration tests for container communication
   - Implement performance benchmarks
   - Create migration tests
   - Add monitoring for protocol usage

   **Task 6: Migration Strategy**
   - Implement gradual rollout mechanism
   - Add feature flags for protocol selection
   - Create HTTP fallback mechanism
   - Add logging for protocol usage
   - Create dashboard for migration tracking

3. **Generate test plan**:
   - Unit tests: ACP client, message handling, connection management
   - Integration tests: Container lifecycle with ACP, message exchange
   - Performance tests: Latency comparison, throughput, connection scaling
   - Migration tests: Protocol switching, fallback behavior
   - Error handling tests: Connection failure, message errors, recovery

4. **Define milestone sequence**:
   - Milestone 1: ACP client integration with basic functionality
   - Milestone 2: Service layer adaptation with dual protocol support
   - Milestone 3: Database schema updates and migrations
   - Milestone 4: Container management with ACP protocol
   - Milestone 5: Testing and performance validation
   - Milestone 6: Migration strategy implementation
   - Milestone 7: Production deployment with monitoring

**Output**: tasks.md with implementation tasks

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