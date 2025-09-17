# Data Model: ACP Integration (JSON-RPC over stdio)

JSON-RPC message types and session entities for ACP protocol implementation:

## JSON-RPC Message Types

### 1) InitializeRequest
```typescript
{
  jsonrpc: "2.0",
  id: string | number,
  method: "initialize",
  params: {
    protocolVersion: string,  // e.g., "0.3.1"
    clientCapabilities: {
      editWorkspace?: boolean,
      filesRead?: boolean,
      filesWrite?: boolean,
      ...
    }
  }
}
```

### 2) InitializeResponse
```typescript
{
  jsonrpc: "2.0",
  id: string | number,
  result: {
    protocolVersion: string,
    agentCapabilities: {
      editWorkspace: boolean,
      filesRead: boolean,
      filesWrite: boolean,
      sessionPersistence: boolean,
      streamingUpdates: boolean
    },
    agentInfo: {
      name: "Claude Code Container",
      version: string
    }
  }
}
```

### 3) SessionNewRequest
```typescript
{
  jsonrpc: "2.0",
  id: string | number,
  method: "session/new",
  params: {
    workspaceUri?: string,  // file:///path/to/repo
    mode?: "conversation" | "development"
  }
}
```

### 4) SessionPromptRequest
```typescript
{
  jsonrpc: "2.0",
  id: string | number,
  method: "session/prompt",
  params: {
    sessionId: string,
    content: ContentBlock[],  // Text, images, etc.
    contextFiles?: string[]   // File paths for context
  }
}
```

### 5) SessionUpdateNotification
```typescript
{
  jsonrpc: "2.0",
  method: "session/update",
  params: {
    sessionId: string,
    content: ContentBlock[],
    status: "thinking" | "working" | "completed" | "error"
  }
}
```

## Session Management Entities

### 6) ACPSession
- sessionId: string (UUID)
- workspaceUri?: string
- mode: 'conversation' | 'development'
- state: 'active' | 'paused' | 'completed' | 'error'
- createdAt: number
- lastActiveAt: number
- messageHistory: ContentBlock[][]
- workspaceState?: { currentBranch?: string, modifiedFiles?: string[] }

### 7) ContentBlock
- type: 'text' | 'image' | 'diff' | 'file' | 'thought'
- content: string
- metadata?: { [key: string]: any }

### 8) AgentCapabilities
- editWorkspace: boolean (can modify files)
- filesRead: boolean (can read repository files)
- filesWrite: boolean (can create/update files)
- sessionPersistence: boolean (maintains session state)
- streamingUpdates: boolean (sends real-time updates)
- githubIntegration: boolean (can create PRs, issues)

## Storage Strategy (Container-based)

**In-Container Storage** (primary):
- Session state in memory with file backup
- Message history in temporary files
- Workspace isolation via Docker volumes

**Optional Durable Object Persistence** (for multi-container scenarios):
- `ACP_SESSION_DO`: Session metadata and history references
- `WORKSPACE_STATE_DO`: Persistent workspace state

## Message Flow Examples

**Initialization Flow**:
```
Zed → initialize(clientCapabilities) → Container
Zed ← initialize_response(agentCapabilities) ← Container
```

**Session Creation**:
```
Zed → session/new(workspaceUri) → Container
Zed ← session_id ← Container
```

**Prompt Processing**:
```
Zed → session/prompt(sessionId, content) → Container
Zed ← session/update(thinking) ← Container (notification)
Zed ← session/update(working) ← Container (notification)
Zed ← session/update(completed) ← Container (notification)
Zed ← prompt_response(result) ← Container
```

## Validation Rules

- sessionId must be UUID format
- workspaceUri must be valid file:// URI if provided
- Content blocks must have valid type and content
- Message history limited to 100MB per session
- Session timeout: 2 hours of inactivity

## State Transitions

**Session States**:
- active: Currently processing or waiting for input
- paused: Suspended, can be resumed
- completed: Successfully finished
- error: Failed, requires intervention
