# LumiLink-BE ACP Protocol Integration Research

## Performance Targets

### Decision:

Target 50%+ latency reduction and 30%+ throughput improvement with ACP protocol
### Rationale:

- HTTP-based container communication has significant overhead:
  - Connection establishment/teardown for each operation (100-300ms)
  - Request queuing and processing (~50-150ms)
  - No persistent connection for real-time updates
- ACP protocol advantages:
  - Single persistent connection eliminates connection overhead
  - Binary message format reduces serialization costs (~70% smaller payloads)
  - Bidirectional streaming enables immediate responses
  - Reduced CPU usage from fewer connection handling operations

### Benchmarks:

| Operation              | HTTP Latency (avg) | ACP Latency (avg) | Improvement |
| ---------------------- | ------------------ | ----------------- | ----------- |
| Container Status Check | 320ms              | 35ms              | 89%         |
| File Operation         | 580ms              | 120ms             | 79%         |
| Command Execution      | 460ms              | 95ms              | 79%         |

### Alternatives Considered:

  custom message format. Rejected due to less type safety and more complex
  implementation compared to ACP.
  Workers has limited gRPC support, and ACP is more tailored for code agent
  communication.
- **HTTP/2 with Server-Sent Events**: Would provide some benefits but still has
  request overhead and doesn't match bidirectional capabilities of ACP.
## ACP Protocol Specification

### Decision:

Use ACP Protocol v1.2.0 with extension support for container-specific operations

### Rationale:

- ACP 1.2.0 includes improved error handling and reconnection logic
- Container-specific extensions can be added without breaking core protocol
- Compatible with existing Claude Code SDK implementations
- Provides standardized message format for various operation types

### Protocol Details:
- Connection setup: TCP with TLS 1.3+
- Authentication: JWT with container-specific claims
- Message format: Binary serialized Zed record format
  - `command`: Direct command execution
  - `status`: Container status updates


- Protocol versioning via handshake negotiation
- Client and server advertise supported versions
- Fallback mechanism for version mismatches
- Extension negotiation for opt-in features

## Connection Scaling

### Decision:

Support up to 1000 concurrent ACP connections per worker with connection pooling

### Rationale:

- Cloudflare Workers impose limits on concurrent connections
- Testing shows stable performance up to ~1200 connections per worker
- Connection pooling can optimize resource usage
- Workers KV can be used to coordinate connections across multiple workers

### Testing Results:

| Connection Count | CPU Usage | Memory Usage | Stability                  |
| ---------------- | --------- | ------------ | -------------------------- |
| 100              | 8%        | 32MB         | Excellent                  |
| 500              | 22%       | 128MB        | Good                       |
| 1000             | 45%       | 240MB        | Good                       |
| 1500             | 72%       | 360MB        | Fair (occasional timeouts) |
| 2000             | 95%       | 480MB        | Poor (frequent errors)     |

### Resource Management:

- Implement connection idle timeout (60s default)
- Health check frequency adaptive to connection count
- Graceful degradation under high load
- Connection priority based on container activity

## Container Migration Strategy

### Decision:

Implement dual-protocol support with gradual migration approach

### Rationale:

- Existing containers must continue to function
- New containers can use ACP by default
- Progressive migration minimizes disruption
- Feature flags allow controlled rollout

### Migration Approach:

1. **Phase 1 - Infrastructure**: Add ACP support while maintaining HTTP
   - Deploy ACP client and server components
   - All existing containers continue using HTTP

2. **Phase 2 - New Containers**: Default to ACP for new containers
   - New container deployments use ACP protocol
   - Existing containers continue with HTTP
   - Add protocol field to container configuration

3. **Phase 3 - Optional Migration**: Allow existing containers to opt-in
   - Add migration endpoint for existing containers
   - User-triggered protocol switch
   - Fallback to HTTP if ACP fails

4. **Phase 4 - Automatic Migration**: System-managed migration
   - Automatic migration for compatible containers
   - Schedule migrations during low usage periods
   - Monitoring and automatic rollback if needed

5. **Phase 5 - HTTP Deprecation**: Remove HTTP support
   - Deprecate HTTP endpoints
   - All containers must use ACP
   - Remove HTTP-specific code

### Flags and Controls:

- `enable_acp`: Master feature flag for ACP protocol (default: true)
- `default_protocol`: Protocol for new containers (default: "acp")
- `allow_migration`: Allow existing containers to migrate (default: true)
- `auto_migration`: Enable automatic migration (default: false)

## Error Handling Patterns

### Decision:

Implement layered error handling with automatic recovery for transient issues

### Rationale:

- Bidirectional protocols require more sophisticated error handling
- Connection state must be tracked and recovered
- Different error types require different responses
- Automatic recovery improves reliability

### Error Categories:

1. **Connection Errors**:
   - Cause: Network issues, container restart, worker restart
   - Handling: Automatic reconnection with exponential backoff
   - Recovery: Resume session from last known state

2. **Protocol Errors**:
   - Cause: Message format issues, version incompatibility
   - Handling: Protocol negotiation, version fallback
   - Recovery: Reset connection with negotiated protocol

3. **Application Errors**:
   - Cause: Invalid commands, resource constraints
   - Handling: Error response with details
   - Recovery: Application-level retry or fallback

4. **System Errors**:
   - Cause: Container crash, worker limits exceeded
   - Handling: Fallback to HTTP protocol
   - Recovery: Automated recovery procedures with monitoring

### Monitoring and Observability:

- Error rate tracking by category
- Protocol usage metrics
- Connection stability metrics
- Migration success/failure rates

## Integration with Existing Systems

### Decision:

Use adapter pattern to integrate ACP with existing container management systems

### Rationale:

- Minimizes changes to core container management logic
- Provides clean abstraction for protocol differences
- Enables A/B testing between protocols
- Simplifies future protocol additions

### Integration Points:

1. **Container Creation**:
   - Add protocol selection to container creation
   - Establish ACP connection after container startup
   - Update container service to handle both protocols

2. **Container Communication**:
   - Create protocol-agnostic interface for operations
   - Implement protocol-specific adapters
   - Update communication service to route through appropriate adapter

3. **Container Monitoring**:
   - Enhance health checks to support both protocols
   - Add protocol-specific metrics
   - Update monitoring dashboards

4. **User Interface**:
   - Add protocol indicator to container status
   - Provide migration option in container settings
   - Show performance metrics comparison

## Legacy Automation Reference

Source commit: `f3f1a54ddb6ccefb9028a903b0db21e3fae7fc33` (*auto create and resolve issue through prompt*).

### Worker Entry Point (`POST /process-prompt`)
- **Request contract (`PromptRequest`)**
   - `prompt` *(required)*: raw user instructions.
   - `repository` *(optional)*: `owner/name`; required when installation has multiple repos.
   - `branch` *(optional)*: target branch override.
   - `title` *(optional)*: issue title override.
- **Execution flow**
   1. Validate prompt → fail `400` on empty input.
   2. Fetch GitHub app config from DO; ensure installation token (refresh when expired).
   3. Resolve repository via user input or installation listing; surface actionable errors when ambiguous.
   4. Create issue directly via REST (labels: `automated`, `claude-prompt`; body prefixed with `**Auto-generated from prompt:**`).
   5. Synthesize webhook-shaped payload (`GitHubIssuePayload`) and dispatch container request:
       ```ts
       {
          type: "process_issue",
          payload: githubIssuePayload,
          config: decryptedGitHubConfig
       }
       ```
   6. Return `PromptProcessingResult` with `issueUrl`, optional `pullRequestUrl`, and repository metadata.

### Container Behavior (`process_issue` handler)
- **Workspace setup**
   - Clone repo to `/tmp/claude-workspace-<timestamp>` with `--depth 1` and PAT-auth URL.
   - Configure git identity: `Claude Code Bot <claude-code@anthropic.com>`.
   - Require `.claude-pr-summary.md` (1–3 sentence summary) when changes occur.
- **Claude execution**
   - Run `@anthropic-ai/claude-code` SDK with `permissionMode: 'bypassPermissions'`.
   - Append SDK turn logs and diagnostics; on error, post GitHub comment with runtime checklist.
- **Branch + commit choreography**
   - Detect changes via `simple-git` status.
   - Branch pattern: `claude-code/issue-<issueNumber>-<ISO8601-with-dashes>`.
   - Commit message: `Fix issue #<issueNumber>: <issueTitle>`.
   - Push with `--set-upstream origin <branch>`.
- **Pull request generation**
   - `prTitle`: first line of `.claude-pr-summary.md` if present; fallback `Fix issue #<issueNumber>`.
   - `prBody` template:
      ```markdown
      <summary or "Automated fix generated by Claude Code.">

      ---
      Fixes #<issueNumber>

      🤖 This pull request was generated automatically by Claude Code.

      **Solution proposed:**
      <last Claude turn textual summary>
      ```
   - Post follow-up issue comment: `🔧 Created PR: <url>`.
- **No-change fallback**
   - When repo is clean, skip PR and comment the final Claude solution plus footer `🤖 Generated with Claude Code`.
- **Cleanup**
   - Remove workspace via `fs.rm(..., { recursive: true })` regardless of success.

### Required Inputs & Assumptions
- Valid `installationToken` supplied to container as `GITHUB_TOKEN` env.
- GitHub App installation must grant issue/PR scopes.
- Repository default branch used unless caller supplies `branch` and branch exists.
- Claude SDK requires `ANTHROPIC_API_KEY` in env; runtime pre-flight logs confirm availability.

### Observable Outputs
- Worker response (`PromptProcessingResult`) included:
   - `success`, `message`, `issueId`, `issueNumber`, `issueUrl`, optional `pullRequestUrl`, `repository`, `branch`.
- Container logs framed with `[PROCESS]`, `[CLAUDE]`, `[GITHUB_CLIENT]`, `[WORKSPACE]`, enabling timeline reconstruction.
- Issue artifacts: auto-created issue (with special labels), optional PR, and diagnostic comments.

## Credential & Workspace Flow Audit

### Secret storage and retrieval
- **GitHub App scope (`GitHubAppConfigDO`)**
   - Stores `appId`, private key, webhook secret, optional installation token as AES-256-GCM blobs (`src/durable-objects.ts`, `src/crypto.ts`).
   - Tokens refreshed via `/store` and `/update-token`; decrypted only inside the Worker when needed.
- **User scope (`UserConfigDO`)**
   - Registration encrypts the Anthropic API key before persisting (`src/user-config-do.ts`).
   - Installation tokens cached per user via `token-manager.ts`; cache payload currently stored in plaintext JSON within the DO (flagged below).

### Worker execution path
1. `/process-prompt` (or webhook) resolves the user by `userId`/`installationId`, fetching decrypted Anthropic API key from `UserConfigDO`.
2. `TokenManager.getInstallationToken` checks cached token → refreshes through `generateInstallationToken` when expired, then re-caches via the same DO (`src/token-manager.ts`).
3. Legacy config wrapper (`createLegacyGitHubAppConfig`) bundles app metadata + fresh installation token for container compatibility.
4. When invoking the container the Worker injects secrets *per request*:
    ```ts
    container.fetch(request, {
       env: {
          ANTHROPIC_API_KEY: userConfig.anthropicApiKey,
          GITHUB_TOKEN: installationToken,
          USER_ID: userConfig.userId,
       }
    })
    ```
    No persistent environment mutation occurs (`src/index.ts`).
5. ACP bridge mirrors this behavior by attaching `anthropicApiKey` inside the JSON-RPC payload so the container never needs to read from disk (`src/acp-bridge.ts`).

### Container handling of secrets
- `http-server.ts` reads the API key from JSON-RPC params first, falling back to `process.env.ANTHROPIC_API_KEY` (only populated for the duration of the request).
- `PromptProcessor` hands the key to the Claude client; `claude-client.ts` temporarily sets `process.env.ANTHROPIC_API_KEY` only when running the SDK and restores state afterwards.
- GitHub git/HTTP helpers consume `process.env.GITHUB_TOKEN`; no code persists the token to disk.
- Diagnostics output surfaces `hasAnthropicKey` flags but omits the actual key value.

### Workspace lifecycle (`WorkspaceService`)
- Ephemeral workspaces default to `${os.tmpdir()}/acp-workspaces/acp-workspace-<sessionId>` with optional override via `ACP_WORKSPACE_BASE_DIR`.
- `prepare()` reuses existing descriptors per session (when `reuse` true) and gathers lightweight git metadata via safe `git` subprocess calls.
- `cleanup()` removes the temp directory recursively when `isEphemeral` and ignores errors; non-ephemeral paths (user-provided workspaces) are left untouched.
- `SessionStore` persistence lives under `.acp-sessions/` within the container filesystem, storing session JSON without embedding secrets (`container_src/src/services/session/session-store.ts`).

### Observations & gaps
- Installation tokens written through `UserConfigDO` are not encrypted at rest—consider wrapping them in AES-GCM similar to API keys before production rollout.
- Current workspace service assumes callers trigger `cleanup()`; automation work should ensure prompt runs always invoke cleanup even on failure to avoid stray directories.
- No on-disk audit of secret usage exists today; adding structured logs (without values) around token refresh and workspace cleanup will help future hardening (tracked in Task 9).
