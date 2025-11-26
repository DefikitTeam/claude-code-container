# Data Model: Daytona Migration

**Feature**: migrate-to-daytona
**Branch**: `feat/new-contianerized-mechanism`
**Created**: 2025-11-26

## Core Entities

### 1. DaytonaSandbox

Represents a running Daytona sandbox instance.

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| sandboxId | string | Daytona sandbox identifier | Required, unique |
| language | string | Language environment (e.g., `python`, `typescript`) | Required |
| status | SandboxStatus | Current sandbox state | Enum |
| createdAt | Date | Sandbox creation timestamp | Required |
| timeout | number | Sandbox timeout in seconds | 60-86400 |
| metadata | SandboxMetadata | Associated metadata | Required |

```typescript
interface DaytonaSandbox {
  sandboxId: string;
  language: 'python' | 'typescript' | 'go';
  status: 'creating' | 'running' | 'deleting' | 'deleted' | 'error';
  createdAt: Date;
  timeout: number;
  metadata: SandboxMetadata;
}

interface SandboxMetadata {
  userId: string;
  installationId?: string;
  issueId?: string | number;
  repository?: string;
  taskId?: string;
  [key: string]: string | number | undefined;
}
```

### 2. SandboxConfig

Configuration for creating a new sandbox.

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| language | string | Language for the sandbox | `'python'` |
| timeout | number | Sandbox timeout (seconds) | `3600` |
| envVars | Record<string, string> | Environment variables | `{}` |
| metadata | SandboxMetadata | Tracking metadata | Required |
| cwd | string | Working directory | `'/app'` |

```typescript
interface SandboxConfig {
  language?: 'python' | 'typescript' | 'go';
  timeout?: number;
  envVars: Record<string, string>;
  metadata: SandboxMetadata;
  cwd?: string;
}
```

### 3. SandboxSession

Tracks an active communication session with a sandbox.

| Field | Type | Description |
|-------|------|-------------|
| sessionId | string | Unique session identifier |
| sandboxId | string | Associated sandbox ID |
| status | SessionStatus | Current session state |
| startedAt | Date | Session start time |
| lastActivityAt | Date | Last activity timestamp |
| processId | number? | Background process PID if applicable |

```typescript
interface SandboxSession {
  sessionId: string;
  sandboxId: string;
  status: 'active' | 'idle' | 'completed' | 'failed';
  startedAt: Date;
  lastActivityAt: Date;
  processId?: number;
}
```

### 4. CommandExecution

Represents a command execution within a sandbox.

| Field | Type | Description |
|-------|------|-------------|
| executionId | string | Unique execution identifier |
| sandboxId | string | Sandbox where command runs |
| command | string | Command to execute |
| status | ExecutionStatus | Execution state |
| startedAt | Date | Execution start time |
| completedAt | Date? | Completion time if done |
| exitCode | number? | Process exit code |
| result | string | Combined stdout/stderr |

```typescript
interface CommandExecution {
  executionId: string;
  sandboxId: string;
  command: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'killed';
  startedAt: Date;
  completedAt?: Date;
  exitCode?: number;
  result: string;
}
```

---

## State Transitions

### Sandbox Lifecycle

```
[creating] → [running] → [deleting] → [deleted]
     │                         │
     └──────────→ [error] ←────┘
```

**Transitions:**
- `creating → running`: Sandbox successfully created.
- `creating → error`: Creation failure (quota, API error).
- `running → deleting`: Explicit delete call.
- `running → error`: Runtime failure.
- `deleting → deleted`: Sandbox successfully deleted.
- `deleting → error`: Deletion failure.

### Session Lifecycle

```
[active] → [idle] → [completed]
    │         │          ↑
    └─────────┴─→ [failed]
```

**Transitions:**
- `active → idle`: No activity for threshold period.
- `idle → active`: New activity received.
- `active/idle → completed`: Task finished successfully.
- `active/idle → failed`: Error or sandbox terminated.

---

## Relationship Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     User/GitHub                          │
└──────────────────────┬──────────────────────────────────┘
                       │ Webhook/API Request
                       ▼
┌─────────────────────────────────────────────────────────┐
│                  Cloudflare Worker                       │
│  ┌─────────────────────────────────────────────────┐    │
│  │            DaytonaSandboxService                 │    │
│  │  - create(config: SandboxConfig)                 │    │
│  │  - executeCommand(sandboxId, command)            │    │
│  │  - delete(sandboxId)                             │    │
│  │  - getStatus(sandboxId)                          │    │
│  └─────────────────────────────────────────────────┘    │
└──────────────────────┬──────────────────────────────────┘
                       │ Daytona SDK API Calls
                       ▼
┌─────────────────────────────────────────────────────────┐
│                    Daytona Platform                      │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Daytona Sandbox                     │    │
│  │  ┌─────────────────────────────────────────┐    │    │
│  │  │         Agent Container                  │    │    │
│  │  │  - Process Execution                     │    │    │
│  │  │  - Filesystem API                        │    │    │
│  │  │  - Git Operations                        │    │    │
│  │  └─────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────┘    │
└──────────────────────┬──────────────────────────────────┘
                       │ GitHub API / Git
                       ▼
┌─────────────────────────────────────────────────────────┐
│                       GitHub                             │
│  - Repository Operations                                 │
│  - Pull Request Creation                                 │
│  - Issue Comments                                        │
└─────────────────────────────────────────────────────────┘
```

---

## Mapping: Cloudflare Containers → Daytona Sandboxes

| Cloudflare Concept | Daytona Equivalent | Notes |
|--------------------|--------------------|-------|
| ContainerDO (Durable Object) | Sandbox instance | 1:1 mapping |
| Container image | Daytona language environment | Pre-configured environments |
| Container namespace | Daytona API | SDK handles orchestration |
| sleepAfter timeout | Sandbox timeout | Configurable in SDK |
| fetch() to container | `sandbox.process.executeCommand()` | Command-based interaction |
| envVars | `envVars` parameter | Direct mapping |

---

## Database Considerations

### State Storage (Optional)

For tracking active sandboxes across Worker restarts:

```sql
-- SQLite in Durable Object (existing pattern)
CREATE TABLE IF NOT EXISTS sandbox_sessions (
  session_id TEXT PRIMARY KEY,
  sandbox_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  metadata TEXT, -- JSON
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_sandbox_sessions_sandbox ON sandbox_sessions(sandbox_id);
CREATE INDEX idx_sandbox_sessions_user ON sandbox_sessions(user_id);
```

**Note:** Most state is ephemeral within request lifecycle. Persistent state only needed for:
- Long-running task tracking
- User quota management
- Audit logging

---

## Validation Rules

### SandboxConfig Validation

```typescript
const sandboxConfigSchema = {
  language: {
    type: 'string',
    default: 'python',
    enum: ['python', 'typescript', 'go']
  },
  timeout: {
    type: 'number',
    min: 60,      // 1 minute minimum
    max: 86400,   // 24 hours maximum
    default: 3600 // 1 hour
  },
  envVars: {
    type: 'object',
    required: ['ANTHROPIC_API_KEY'],
    maxKeys: 50,
    maxValueLength: 10000
  },
  metadata: {
    type: 'object',
    required: ['userId']
  }
};
```

### Environment Variable Rules

| Variable | Required | Max Length | Sensitive |
|----------|----------|------------|-----------|
| ANTHROPIC_API_KEY | Yes | 200 | Yes |
| GITHUB_TOKEN | Conditional | 500 | Yes |
| NODE_ENV | No | 20 | No |
| DAYTONA_API_KEY | Worker-side only | 200 | Yes |

---

## Error Types

```typescript
// Daytona-specific errors
class DaytonaSandboxError extends Error {
  constructor(
    message: string,
    public readonly code: DaytonaErrorCode,
    public readonly sandboxId?: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
  }
}

enum DaytonaErrorCode {
  // Creation errors
  CREATE_FAILED = 'DAYTONA_CREATE_FAILED',
  QUOTA_EXCEEDED = 'DAYTONA_QUOTA_EXCEEDED',
  
  // Runtime errors
  SANDBOX_NOT_FOUND = 'DAYTONA_SANDBOX_NOT_FOUND',
  SANDBOX_TIMEOUT = 'DAYTONA_SANDBOX_TIMEOUT',
  EXECUTION_FAILED = 'DAYTONA_EXECUTION_FAILED',
  
  // Communication errors
  CONNECTION_FAILED = 'DAYTONA_CONNECTION_FAILED',
  REQUEST_TIMEOUT = 'DAYTONA_REQUEST_TIMEOUT',
  
  // API errors
  INVALID_API_KEY = 'DAYTONA_INVALID_API_KEY',
  RATE_LIMITED = 'DAYTONA_RATE_LIMITED'
}
```
