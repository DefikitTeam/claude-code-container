# Data Model: LumiLink Backend ACP Integration

## Overview

These entities extend the existing worker and container systems to support ACP-first communication, automated rollback, GitHub automation continuity, and user-facing notifications. Models are expressed conceptually; implementations may span Durable Objects, KV namespaces, or in-memory session payloads depending on runtime constraints.

## Core Entities

### ACPConnectionRecord
- **Purpose**: Track the state of each ACP session between LumiLink-BE and a container.
- **Key Fields**:
  - `connectionId` (string, primary identifier from ACP handshake)
  - `installationId` (string, tenant scope)
  - `workspaceId` (string, workspace/session grouping)
  - `status` (enum: `connecting`, `connected`, `degraded`, `error`, `reconnecting`, `rolledBack`)
  - `protocolVersion` (semver string, e.g., `1.2.0`)
  - `negotiatedCapabilities` (JSON array of feature flags)
  - `successRate` (float percentage over rolling 1-hour window)
  - `latencyP95` (milliseconds)
  - `throughputPerMin` (operations/minute)
  - `lastHeartbeat` (timestamp)
  - `rollbackTriggered` (boolean)
  - `diagnostics` (array of structured log/event references)
- **Lifecycle**:
  1. `connecting` → `connected` after handshake.
  2. `connected` → `degraded` when latency or errors rise but remain within tolerance.
  3. `degraded` → `error` when success rate < threshold or connection drops.
  4. `error` → `reconnecting` during automated recovery attempts.
  5. Any state → `rolledBack` when workbook reverts to HTTP transport.
- **Constraints**: `successRate` computed using sliding window. When `rollbackTriggered` true, system must schedule transport change and record cause.

### ProtocolMigrationLog
- **Purpose**: Audit transitions between HTTP and ACP for each workspace.
- **Key Fields**:
  - `migrationId` (UUID)
  - `workspaceId`
  - `initiatedBy` (enum: `system`, `operator`, `user`)
  - `fromProtocol` / `toProtocol` (enum: `http`, `acp`)
  - `startedAt` / `completedAt` (timestamps)
  - `status` (enum: `inProgress`, `succeeded`, `rolledBack`, `failed`)
  - `rollbackReason` (string, optional, aligned with skip/alert codes)
  - `metricsSnapshot` (JSON: success rate, capacity, latency at decision time)
- **Relationships**: Links to `ACPConnectionRecord` via `workspaceId` to reconstruct context; feeds compliance reporting.

### GitHubAutomationSummary
- **Purpose**: Persist automation outcomes and diagnostics for each ACP prompt session.
- **Key Fields**:
  - `sessionId` (string)
  - `status` (enum: `success`, `skipped`, `error`)
  - `issue` (object with `id`, `number`, `url`, `title`)
  - `pullRequest` (object with `number`, `url`, `branch`)
  - `commit` (object with `sha`, `message`)
  - `skipReason` (enum: `repoBlocked`, `missingCredential`, `automationDisabled`, `rateLimited`, `other`)
  - `toastMessage` (string <=140 chars, localized later)
  - `transcriptNote` (string summary stored alongside session conversation)
  - `durationMs` (integer)
  - `error` (object with `code`, `message`, `retryable`)
  - `logs` (array of structured diagnostic entries)
- **Constraints**: `toastMessage` must never include secrets. `status=skipped` requires `skipReason`, `toastMessage`, `transcriptNote`.

### CapacityAlert
- **Purpose**: Represent threshold events for ACP concurrency and resource pressure.
- **Key Fields**:
  - `alertId` (UUID)
  - `installationId`
  - `workspaceIds` (array) if scope spans multiple workspaces
  - `trigger` (enum: `warning`, `critical`)
  - `activeConnections` (integer)
  - `capacityPercent` (float)
  - `timestamp`
  - `notified` (bool) / `notificationChannels` (array: `toast`, `email`, `webhook`)
  - `resolvedAt` (timestamp optional)
- **Lifecycle**: `warning` emitted at ≥85% of capacity, `critical` at ≥95%; resolution recorded once load drops below 70% for 5 minutes.

### RollbackEvent (Worker DO Memo)
- **Purpose**: Capture automatic or manual rollback decisions for audit trails.
- **Key Fields**:
  - `eventId` (UUID)
  - `workspaceId`
  - `trigger` (enum: `autoThreshold`, `manualOperator`, `manualUser`)
  - `reasonCode` (enum aligning with GitHubAutomationSummary skip reasons + `capacity`)
  - `initiatedAt` / `completedAt`
  - `previousProtocol`
  - `newProtocol`
  - `followUpActions` (array: e.g., `notifyUsers`, `scheduleReview`)
- **Relationship**: References latest `ACPConnectionRecord` snapshot and `ProtocolMigrationLog` entry.

## Supporting Structures

### SessionTranscriptEntry (Augmented)
- Adds `eventType` (enum: `automation`, `toast`, `rollback`, `info`) and `context` (JSON) to differentiate user-visible log entries captured in transcripts.

### MetricsEnvelope
- Standard payload emitted for analytics pipelines containing `timestamp`, `installationId`, `workspaceId`, `metricType`, `value`, `thresholdBreached`, aligning ACP metrics with existing dashboards.

## Relationships Overview

- `ACPConnectionRecord` ↔ `ProtocolMigrationLog`: 1-to-many via `workspaceId`.
- `GitHubAutomationSummary` ↔ `SessionTranscriptEntry`: 1-to-many (each automation event may create one transcript entry).
- `CapacityAlert` may reference multiple `ACPConnectionRecord` instances through shared `installationId`.
- `RollbackEvent` ties together `ACPConnectionRecord`, `ProtocolMigrationLog`, and `GitHubAutomationSummary` (when rollback caused automation skip).

## Data Validation Notes

- Ensure all percentages stored as decimals (0.0–1.0) or explicit percentages but consistent across systems.
- Use ISO 8601 timestamps (UTC) for durability across Worker and container runtimes.
- Normalize enum string values to kebab-case for consistency with existing contracts (`missing-credential`, `repo-blocked`).
- Keep payload sizes <32KB to remain within Durable Object storage and Worker response limits.
