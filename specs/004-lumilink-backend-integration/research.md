# LumiLink Backend ACP Integration Research

## ACP Performance & Instrumentation

- **Decision**: Track latency, throughput, and success metrics per session directly from ACP bridge and container logs, targeting ≥50% latency reduction and ≥30% throughput gain.
- **Rationale**: Runtime measurements tied to Durable Objects and container diagnostics provide the most accurate view without introducing new infrastructure.
- **Alternatives Considered**:
  - External APM service (overkill for Worker env, additional latency).
  - Passive log scraping (slower feedback loop, harder to correlate with sessions).

## Reliability & Auto-Rollback Thresholds

- **Decision**: Trigger automatic rollback to HTTP whenever ACP success rate falls below 99% over a rolling 1-hour window for any workspace.
- **Rationale**: Aligns with clarified requirement; balances sensitivity to genuine outages without flapping on transient errors.
- **Alternatives Considered**:
  - Fixed consecutive failure count (ignores volume differences).
  - Manual-only rollback (slower recovery, violates requirement).

## Capacity Management

- **Decision**: Enforce 1,000 concurrent ACP sessions per worker with warning at 85% utilization and fail-closed beyond 95% to maintain CPU headroom.
- **Rationale**: Matches research benchmarks and spec expectations; early warning gives operators time to act before hitting limits.
- **Alternatives Considered**:
  - Hard stop at 1,000 without warning (little operational cushion).
  - Unlimited connections with best-effort handling (risks Worker instability).

## GitHub Automation Continuity

- **Decision**: Preserve existing automation flow (issue, branch, PR, diagnostics) while extending payloads to include skip reasons, rollback markers, and structured error codes.
- **Rationale**: Maintains parity with legacy HTTP behaviour; additions support new telemetry and toast notifications.
- **Alternatives Considered**:
  - Rewriting automation pipeline (unnecessary scope increase).
  - Reducing outputs to simplify (breaks stakeholder reporting needs).

## User Notification Strategy

- **Decision**: Emit a real-time toast within LumiLink-BE and append the skip reason to the session transcript whenever automation is bypassed.
- **Rationale**: Satisfies clarified UX requirement; transcript entry preserves audit trail beyond ephemeral toast.
- **Alternatives Considered**:
  - Email alerts (slower feedback, harder for in-session workflows).
  - Silent logging only (fails business expectation for user awareness).

## Observability & Alerting

- **Decision**: Extend structured logs with `[ACP]`, `[GITHUB-AUTO]`, `[ROLLBACK]`, and `[CAPACITY]` markers; export metrics (success rate, latency, capacity) to existing analytics pipeline and raise alerts at threshold breaches.
- **Rationale**: Reuses existing logging infrastructure and analytics dashboards, enabling quick triage and historical analysis.
- **Alternatives Considered**:
  - Introducing new logging service (time-consuming, redundant).
  - Minimal logging (insufficient for compliance and diagnostics).

## Security & Secrets Handling

- **Decision**: Continue per-request secret injection with no persistence, reusing token manager and workspace cleanup flows; ensure skip notifications never contain raw tokens.
- **Rationale**: Meets security requirements without architecture changes; consistent with current secret handling posture.
- **Alternatives Considered**:
  - Storing secrets in container env between calls (risk of leakage).
  - Passing tokens via new channel (unnecessary complexity).

## Migration Strategy

- **Decision**: Roll out ACP in phases—default for new sessions, opt-in for existing workspaces, automatic migration once health stays above threshold, with auto rollback when thresholds fail.
- **Rationale**: Minimizes disruption, provides observability during transition, satisfies phased rollout requirement.
- **Alternatives Considered**:
  - Big-bang cutover (higher outage risk).
  - Permanent dual-protocol without migration (delays benefits, complicates support).

## Transport Options & Reusable Client

- **Observation**: This repo provides a reusable ACP client package: `@defikitteam/claude-acp-client` (bin: `claude-acp-client`). It supports:
  - ACP stdio mode (native): lowest latency, best streaming; requires managed process lifecycle.
  - HTTP server mode: starts a local HTTP server the Worker can call; simpler connectivity, slightly higher latency.
  - HTTP bridge mode: HTTP client bridging to a remote worker; niche/fallback topology.

- **Decision**: Prefer ACP stdio as primary; support HTTP server as a fallback for environments where stdio isn’t viable. Host platforms (e.g., lumilink-be) implement a thin bridge/service and the session routing only—no protocol reimplementation.

