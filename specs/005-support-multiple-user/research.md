# Phase 0 Research: Multi-project registrations under a shared GitHub installation

## Decision 1: Registration storage model
- **Decision**: Maintain one Durable Object namespace but allow each installation identifier to map to an ordered list of registration records.
- **Rationale**: Preserves encrypted Anthropic key handling, avoids cross-object coordination, and requires minimal change to existing storage APIs.
- **Alternatives Considered**:
  - *Dedicated Durable Object per installation*: rejected due to migration overhead and the need for new bindings.
  - *External KV or D1 table*: rejected to keep all secrets within encrypted Durable Object storage and avoid latency increases.

## Decision 2: Migration strategy for existing data
- **Decision**: On first read/write after deployment, lift single `installation:{id}` entries into a list structure while retaining the existing `user:{id}` records untouched.
- **Rationale**: Enables a safe, incremental migration without downtime; no separate migration job required.
- **Alternatives Considered**:
  - *Offline bulk migration script*: rejected to avoid operational risk and ensure compatibility across environments.

## Decision 3: Disambiguation policy for API calls
- **Decision**: Require clients to supply both `installationId` and `userId` for operations that target a specific registration; when `userId` is omitted, respond with HTTP 409 and a guidance payload listing available registrations.
- **Rationale**: Forces explicit selection, preventing accidental cross-project leakage and aligning with spec requirement FR-004.
- **Alternatives Considered**:
  - *Implicitly select the first registration*: rejected because ordering would be arbitrary and brittle.
  - *Default to most recently updated registration*: rejected to avoid non-deterministic behavior across requests.

## Decision 4: Concurrency handling within Durable Object
- **Decision**: Continue using the Durable Object to serialize state changes; extend existing register/update handlers to avoid race conditions when multiple registrations arrive simultaneously.
- **Rationale**: Durable Objects already guarantee single-threaded execution per instance, so no additional locking required beyond careful list manipulation.
- **Alternatives Considered**:
  - *Introduce optimistic concurrency tokens*: deemed unnecessary given DO guarantees and added complexity.

## Decision 5: Testing approach
- **Decision**: Add unit tests targeting the Durable Object register/list operations plus integration tests for `/register-user` covering duplicate installation scenarios.
- **Rationale**: Ensures both storage and HTTP surfaces honor multi-registration rules and regression-tests the migration path.
- **Alternatives Considered**:
  - *Rely solely on integration tests*: rejected to keep fast unit coverage for storage transformations.
