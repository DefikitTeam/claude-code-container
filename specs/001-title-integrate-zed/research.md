# Research: Integrate Zed ACP for multi-agent communication (UPDATED)

Date: 2025-09-15 | Updated: 2025-09-16

**CRITICAL UPDATE**: Initial research was based on incorrect assumptions about
ACP protocol. ACP uses subprocess spawning with stdio JSON-RPC communication,
NOT HTTP endpoints.

## Corrected Research Findings

### ACP Protocol Architecture

- **Transport**: JSON-RPC 2.0 over stdin/stdout (newline-delimited)
- **Process Model**: Agents run as subprocesses spawned by clients (Zed editor)
- **Communication**: Bidirectional JSON-RPC with streaming notifications
- **Session Management**: Stateful sessions with workspace isolation

### Core ACP Methods (Verified)

1. **initialize**: Capability negotiation and protocol version agreement
2. **session/new**: Create isolated workspace session
3. **session/prompt**: Send user prompts for processing
4. **session/update**: Real-time progress notifications (streaming)
5. **session/load**: Restore previous session state
6. **cancel**: Stop ongoing operations

### Implementation Strategy (CORRECTED)

- **Container Role**: Transform Claude Code container into ACP-compliant agent
- **Dual Interface**: Maintain HTTP API for backward compatibility, add stdio
  JSON-RPC for ACP
- **Session Isolation**: Each ACP session = isolated workspace within container
- **Authentication**: Inherit GitHub tokens from container environment (no
  separate ACP auth needed)

### Architecture Decisions (UPDATED)

**FR-006 (Authorization model)**: DECISION — Simplified approach using
container's existing GitHub App credentials. ACP sessions inherit repository
permissions from container environment. No separate agent-to-installation
mapping needed. Rationale: Leverages existing security model, reduces
complexity.

**FR-005 (Context size limits)**: DECISION — Support inline contexts up to ~8k
tokens in JSON-RPC messages. Larger contexts handled via file references within
workspace. Rationale: JSON-RPC payload limits and workspace-based context
sharing.

**Transport & Communication**: DECISION — Implement stdio JSON-RPC as primary
ACP interface. Container detects communication mode (stdio vs HTTP) and routes
accordingly. Rationale: Aligns with actual ACP specification requirements.

**Session Management**: DECISION — In-container session state with optional
file-based persistence. Each session gets isolated workspace directory.
Rationale: Simpler than Durable Objects for container-based architecture.

**Streaming Strategy**: DECISION — Use JSON-RPC notifications for real-time
updates during prompt processing. Buffer notifications if stdio cannot keep up.
Rationale: Provides responsive user experience while handling backpressure.

## Implementation References

### ACP Protocol Sources

- **Official Repository**:
  https://github.com/zed-industries/agent-client-protocol
- **TypeScript Library**: @zed-industries/agent-client-protocol (v0.3.1)
- **Documentation**: https://agentclientprotocol.com
- **Schema**: JSON schema with method definitions and message formats

### Integration Patterns

- **Subprocess Management**: Docker containers as spawned ACP agents
- **stdio Handling**: Newline-delimited JSON-RPC over stdin/stdout
- **Error Handling**: Standard JSON-RPC error codes with ACP-specific extensions
- **Workspace Isolation**: Volume mounting and filesystem isolation

### Container Integration

- **Backward Compatibility**: Existing HTTP API remains functional
- **Mode Detection**: Check for stdin availability to determine ACP vs HTTP mode
- **Claude Code SDK**: Reuse existing prompt processing and GitHub integration
- **Environment**: Inherit ANTHROPIC_API_KEY, GITHUB_TOKEN from container
  environment

## Resolved Specifications Issues

**Original Issue**: Specification incorrectly assumed HTTP-based Worker
endpoints with Durable Objects.

**Resolution**: Architecture redesigned for container-based ACP agent with stdio
interface. Durable Objects removed from critical path (optional for
multi-container scenarios only).

**Testing Strategy**: JSON-RPC contract tests replace HTTP endpoint tests.
Integration tests with actual Zed editor verify end-to-end functionality.

## Outstanding Questions (Clarified)

1. **Session Persistence**: Container-based sessions naturally expire when
   container stops. Should we implement cross-container session persistence?
   RECOMMENDATION: Start with in-container sessions, add persistence if
   multi-container deployment needed.

2. **Performance Optimization**: Large repositories may impact JSON-RPC message
   sizes and processing time. RECOMMENDATION: Implement workspace file filtering
   and incremental context loading.

3. **Error Recovery**: How should agent handle partial workspace corruption or
   interrupted operations? RECOMMENDATION: Implement workspace checkpointing and
   rollback mechanisms.

## References (Updated)

- Agent Client Protocol specification and TypeScript implementation
- Zed editor ACP integration documentation
- Container architecture patterns for subprocess communication
- JSON-RPC 2.0 specification for message formatting
- Docker volume management for workspace isolation
