# Research: Integrate Zed ACP for multi-agent communication

Date: 2025-09-15

Summary of open questions from spec and decisions made:

- FR-006 (Authorization mapping): DECISION — Default to operator-mapped trust model. Operators register mappings between ACP agent identity (agentId or public key) and GitHub installationId / userId. This mapping is required for any ACP-initiated action that requires repository write privileges. Rationale: safest default for multi-tenant environment and respects existing GitHub installation model. Alternatives: automatic mapping (risky) or OAuth-style per-agent installation (more complex).

- FR-005 (Context size limits): DECISION — Support inline contexts up to ~8k tokens (~250 KB) for reasoning traces and metadata. For larger contexts, deliver as artifact references: provide file diffs or container workspace snapshot IDs. Rationale: Token/window limits for LLMs and network reliability.

- Persistence & Queues: DECISION — Use Durable Objects for session records (ACP_SESSION_DO) and outbound queue (ACP_QUEUE_DO). Rationale: durable, per-object concurrency model fits session/queue needs.

- Transport: DECISION — Implement HTTP POST-based ACP message ingestion first (easy to route through Worker). Add optional WebSocket/persistent connection support later if needed.

- Security: DECISION — Require operator to configure ACP trust mappings; store minimal public-key material in GitHubAppConfigDO (encrypted). Use structured audit logs for session events.

Implementation notes and references:
- Use existing Durable Object boarding pattern in repo (see `src/durable-objects.ts` and `src/index.ts` for examples of creating and calling container DOs).
- For message forwarding: reuse the same `container.fetch('https://container/process-issue', ...)` call pattern used in webhook and prompt flows, adding env overrides (ANTHROPIC_API_KEY, GITHUB_TOKEN) where necessary.
- Backoff & retry: exponential backoff with jitter; store retry metadata in `ACP_QUEUE_DO` with nextAttempt timestamp.

Open questions for operator/PO (to resolve before production):
1. Do you want automatic mapping between ACP identities and GitHub installations for internal/trusted agents, or strictly operator-approved mappings? (spec FR-006)
2. Preferred maximum inline context size (I suggested 8k tokens). Agree or adjust?

References:
- Cloudflare Durable Objects docs (pattern used in repo)
- Zed ACP protocol (assumed HTTP semantics; obtain exact spec to refine contracts)
