# Feature Specification: LumiLink Backend ACP Integration

**Feature Branch**: `004-lumilink-backend-integration`  
**Created**: October 28, 2025  
**Status**: Draft  
**Input**: User description: "Deliver a LumiLink backend integration spec that captures the ACP migration goals, performance expectations, GitHub automation outcomes, and stakeholder-facing requirements."

## Clarifications

### Session 2025-09-26
- Q: To support FR-007 around automated rollback, what reliability trigger should automatically switch a workspace back to HTTP? → A: Falling below 99% successful ACP sessions over a rolling 1-hour window
- Q: When ACP automation is skipped (e.g., repo blocked or missing credentials), how should LumiLink-BE notify the user? → A: Trigger a real-time toast plus add a note to the session transcript

## User Scenarios & Testing *(mandatory)*

### Primary User Story
As a LumiLink operations lead coordinating AI-assisted code changes, I need LumiLink-BE to communicate with Claude Code containers through the ACP protocol so that container sessions respond faster, surface live status, and still produce the GitHub artifacts our teams rely on.

### Acceptance Scenarios
1. **Given** a LumiLink administrator enabling ACP for a new workspace, **When** they launch a container session from LumiLink-BE, **Then** the session forms an ACP connection and immediately reports live status updates without relying on HTTP APIs.
2. **Given** an existing customer workspace that previously used HTTP, **When** the ACP rollout flag is turned on, **Then** the workspace continues to deliver identical GitHub automation outputs (issues, branches, PRs) while users notice improved responsiveness.
3. **Given** a container experiencing a transient network interruption during an ACP session, **When** connectivity degrades, **Then** LumiLink-BE automatically reconnects, informs the user of the brief disruption, and resumes the automation flow without data loss.
4. **Given** a compliance reviewer auditing automation events, **When** they open the LumiLink reporting view, **Then** they can see ACP connection history, GitHub automation summaries, and any fallbacks that occurred for each session.

### Edge Cases
- How does the system react when ACP negotiation fails because the container only supports older protocol versions?
- What happens if ACP capacity briefly exceeds 1,000 concurrent sessions per worker during peak demand?
- How are users alerted when ACP automation is skipped due to repository blocking rules or missing credentials?
- What is the recovery path when GitHub rate limits block ACP-triggered pushes or pull requests?
- When ACP automation is skipped because of blocked repositories or missing credentials, the session MUST immediately display a toast warning and capture the skip reason in the session transcript for audit.
- How is rollback handled when partial migrations leave some containers on HTTP while others run ACP?

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001**: System MUST default all new LumiLink-BE container sessions to the ACP protocol and confirm the negotiated version during session setup.
- **FR-002**: System MUST preserve HTTP communication as a managed fallback path that activates automatically when ACP negotiation or stability checks fail, while notifying the user about the fallback event.
- **FR-003**: System MUST migrate existing HTTP-based LumiLink-BE workspaces through a phased rollout (opt-in, scheduled, automatic) without interrupting ongoing container operations.
- **FR-004**: System MUST surface real-time ACP session telemetry (connection status, live progress, estimated completion) inside LumiLink-BE so users can track automation in flight.
- **FR-005**: System MUST deliver the same GitHub automation outputs (issues, branches, commits, pull requests, diagnostics) that the legacy HTTP flow produced, with responses embedded in the ACP session results.
- **FR-006**: System MUST record ACP connection history and GitHub automation outcomes so auditors can view when automation ran, what artifacts were produced, and why runs succeeded, skipped, or failed.
- **FR-007**: System MUST support manual and automated rollback from ACP to HTTP for any workspace when ACP success rates drop below 99% across a rolling 1-hour window, with the switch triggering automatically and notifying affected users.
- **FR-008**: System MUST enforce security controls by re-using existing LumiLink credential handling (per-session token provisioning, no secrets persisted) across the ACP pathway.
- **FR-009**: System MUST expose administrative controls to set default protocol, enable migration, and toggle automatic rollout on a per-tenant basis.
- **FR-010**: System MUST alert LumiLink operators when ACP sessions approach connection capacity limits so they can preemptively scale or defer sessions.
- **FR-011**: System MUST detect and classify ACP errors (connection, protocol, application, system) and guide users with actionable recovery messages.
- **FR-012**: System MUST log ACP automation events in LumiLink analytics so business stakeholders can measure adoption, success rates, and performance gains.
- **FR-013**: System MUST surface a real-time toast alert inside the active session and append the skip reason to the session transcript whenever ACP automation is bypassed.

### Non-Functional Requirements
- **NFR-001**: ACP-enabled sessions MUST deliver at least a 50% reduction in average operation latency and a 30% improvement in throughput compared with the prior HTTP baseline, measured across representative workloads.
- **NFR-002**: ACP infrastructure MUST sustain 1,000 concurrent active connections per worker instance without exceeding 50% error-free CPU headroom and MUST gracefully shed load beyond that point.
- **NFR-003**: ACP sessions MUST achieve 99.5% availability per calendar month, including automatic reconnection after transient outages.
- **NFR-004**: Protocol migrations MUST complete without data loss, preserving workspace state, Claude conversation history, and GitHub automation results.
- **NFR-005**: Monitoring MUST provide real-time dashboards for protocol mix, connection stability, automation success rate, and fallback frequency to support operational reviews.

### Key Entities *(include if feature involves data)*
- **ACP Connection Record**: Captures each LumiLink-BE ↔ container session handshake, negotiated protocol version, status transitions, and connection health metrics.
- **Protocol Migration Log**: Chronicles each workspace migration event, including trigger (manual, scheduled, automatic), timing, outcome, and any rollbacks.
- **GitHub Automation Summary**: Stores the structured issue/branch/PR details, diagnostics, and skip reasons generated from each ACP-run automation cycle for audit and analytics purposes.
- **Capacity Alert**: Represents threshold breaches (e.g., concurrent connection limits, retry storms) and the notifications sent to operations teams.

## Implementation notes (lumilink-be main)

This specification applies directly to the current lumilink-be codebase:

- New ACP endpoints will be added under `src/route/acp.ts` and registered in `src/index.ts` via `app.route("/acp", acp)`.
- Live ACP session state will be maintained via a new Durable Object `AcpConnectionDO` under `src/durable-objects/acp-connection-do.ts` with a corresponding binding in `wrangler.toml` and a new migration tag.
- The service `src/services/acp-bridge.service.ts` will orchestrate ACP requests, apply skip/rollback rules, and embed GitHub automation results into the ACP session envelope.
- Persistent audit trails (protocol migrations and automation runs) will be recorded through minimal additions to `prisma/schema.prisma`, following the repository’s D1 migration practices.
- User notifications (toasts + transcript entries) will reuse existing notification services and websockets.

Execution approach: start from a fresh branch off lumilink-be/main to minimize drift and align with current bindings and routes.

## Review & Acceptance Checklist
*GATE: Automated checks run during main() execution*

### Content Quality
- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

### Requirement Completeness
- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous  
- [x] Success criteria are measurable
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Execution Status
*Updated by main() during processing*

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed

