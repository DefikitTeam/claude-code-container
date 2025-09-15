# Data Model: ACP Integration

Entities derived from spec and research:

1) AgentIdentity
- id: string (agentId)
- publicKey?: string
- capabilities: string[]
- trustLevel: 'operator-mapped' | 'internal' | 'untrusted'
- createdAt: number
- lastSeenAt: number

2) ACPSession
- sessionId: string (primary key)
- agentId: string (foreign key => AgentIdentity)
- handshakeState: 'pending' | 'established' | 'expired'
- negotiatedCapabilities: string[]
- lastHeartbeat: number

3) ACPMessage
- messageId: string
- type: 'request' | 'response' | 'event'
- sender: string (agentId)
- target?: string (agentId or sessionId)
- timestamp: number
- payload: any
- signature?: string

4) OutboundQueueItem
- id: string
- message: ACPMessage
- retries: number
- backoffMs: number
- nextAttemptAt: number
- status: 'pending' | 'in-flight' | 'failed' | 'delivered'

5) SessionAuditRecord
- id: string
- sessionId: string
- eventType: 'handshake' | 'message' | 'error' | 'auth' | 'disconnect'
- details: any
- timestamp: number

Durable Object assignments (recommended):
- `ACP_SESSION_DO` stores ACPSession and SessionAuditRecord (per-agent namespace keyed by agentId/sessionId)
- `ACP_QUEUE_DO` stores OutboundQueueItem queue (single DO or sharded by agentId)
- `GITHUB_APP_CONFIG_DO` continues to store encrypted installation keys (already in repo)

Validation rules (examples):
- AgentIdentity.agentId must be unique
- ACPSession.sessionId must be registered before messages are accepted
- OutboundQueueItem.nextAttemptAt computed with exponential backoff: base=2s, factor=2, cap=1 hour, jitter=0-1s

State transitions (high-level):
- Session: pending -> established (on successful handshake) -> expired (timeout) -> destroyed
- Queue item: pending -> in-flight -> delivered OR failed (after max retries)
