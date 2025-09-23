(The file
`/Users/duwm/Documents/LumiLink/claudecode-modern-container/specs/001-title-integrate-zed/spec.md`
exists, but is empty)

````markdown
# Feature Specification: Integrate Zed ACP for multi-agent communication

**Feature Branch**: `001-title-integrate-zed`  
**Created**: 2025-09-15  
**Status**: Draft  
**Input**: User description: "Replace the current pure API communication
mechanism of this claude code container with Zed's ACP to support multi-agent
communication: allow this container's Claude Code agent to communicate with
other agents (Zed ACP) rather than only processing requests in isolation.
Implement agent handshake, message routing, context-sharing, and fallbacks to
the existing API."

## Execution Flow (main)

```
1. Parse user description from Input
	→ If empty: ERROR "No feature description provided"
2. Extract key concepts from description
	→ Identify: actors, actions, data, constraints
3. For each unclear aspect:
	→ Mark with [NEEDS CLARIFICATION: specific question]
4. Fill User Scenarios & Testing section
	→ If no clear user flow: ERROR "Cannot determine user scenarios"
5. Generate Functional Requirements
	→ Each requirement must be testable
	→ Mark ambiguous requirements
6. Identify Key Entities (if data involved)
7. Run Review Checklist
	→ If any [NEEDS CLARIFICATION]: WARN "Spec has uncertainties"
	→ If implementation details found: ERROR "Remove tech details"
8. Return: SUCCESS (spec ready for planning)
```

---

## ⚡ Quick Guidelines

- ✅ Focus on WHAT users need and WHY
- ❌ Avoid HOW to implement (no tech stack, APIs, code structure)
- 👥 Written for business stakeholders, not developers

### Section Requirements

- **Mandatory sections**: Must be completed for every feature
- **Optional sections**: Include only when relevant to the feature
- When a section doesn't apply, remove it entirely (don't leave as "N/A")

---

## User Scenarios & Testing _(mandatory)_

### Primary User Story

As an operator of the Claude Code container, I want the container's agent to
engage in multi-agent conversations over Zed's ACP so that it can request
context, delegate tasks, and coordinate with external AI agents rather than only
accepting isolated API requests.

### Acceptance Scenarios

1. Given a running container and a connected Zed ACP network, when the Claude
   Code agent receives an invitation or discovers a peer agent, then it
   establishes an ACP handshake and advertises its capabilities.
2. Given an incoming multi-agent message requesting repository changes, when the
   message is valid and authorized, then the Claude Code agent routes the
   request into its workspace, produces suggested changes, and replies with
   status updates over ACP.
3. Given loss of ACP connectivity, when the container receives requests via the
   existing API, then it falls back to the current API-only processing mode and
   queues outbound ACP messages for retry.

### Edge Cases

- If an ACP peer repeatedly sends malformed messages, the agent should
  rate-limit and optionally blacklist the peer.
- If two agents concurrently attempt to change the same files, the system should
  surface a merge conflict to human operators (or the originating agents) rather
  than silently overwriting.
- If ACP messages arrive with insufficient context (missing repo, commit ref, or
  permissions), the agent should request clarification rather than acting.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST be able to connect to Zed ACP as a participant and
  maintain a session with peers.
- **FR-002**: System MUST implement an agent handshake protocol (announce agent
  ID, capabilities, supported message types) and respond to incoming handshakes.
- **FR-003**: System MUST support routing and delivery of structured messages
  between agents, including request, response, and event messages.
- **FR-004**: System MUST map ACP messages to internal workflows (e.g., clone
  repo → run agents → generate PR) and return status/results back over ACP.
- **FR-005**: System MUST provide context-sharing semantics: include repository
  metadata, relevant file diffs, and short reasoning traces in messages when
  appropriate.
- **FR-006**: System MUST support authorization checks for ACP-initiated actions
  and respect existing installation/permission model.
- **FR-007**: System MUST gracefully fall back to the existing API processing
  mode when ACP is unreachable or untrusted.
- **FR-008**: System MUST persist a message queue for outgoing ACP messages and
  retry delivery with exponential backoff.
- **FR-009**: System MUST log ACP session events and messages for auditing and
  troubleshooting.
- **FR-010**: System SHOULD support configurable policies for automatic merges,
  conflict resolution, and human-in-the-loop escalation.

_Questions / Clarifications_

- **FR-006** mentions authorization model: [NEEDS CLARIFICATION: should
  ACP-authenticated agents map to GitHub installation tokens, a separate ACP
  identity-to-user mapping, or require operator approval?]
- **FR-005** context size limits: [NEEDS CLARIFICATION: what is the maximum
  message payload or context window we must support?]

### Key Entities _(include if feature involves data)_

- **Agent Identity**: Represents an ACP participant (id, public key,
  capabilities, last-seen)
- **ACP Message**: Structured message (id, type, sender, target, timestamp,
  payload, signature)
- **Outbound Queue Item**: Persisted message pending delivery (message, retries,
  backoff, status)
- **Session Record**: Live session state with peer (handshake state, negotiated
  capabilities, last heartbeat)

---

## Review & Acceptance Checklist

### Content Quality

- [ ] No implementation details (languages, frameworks, APIs) — note: this spec
      names Zed ACP as the required protocol but leaves implementation choices
      open
- [ ] Focused on user value and business needs
- [ ] Written for non-technical stakeholders
- [ ] All mandatory sections completed

### Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain
- [ ] Requirements are testable and unambiguous
- [ ] Success criteria are measurable
- [ ] Scope is clearly bounded
- [ ] Dependencies and assumptions identified

---

## Execution Status

_Updated by main() during processing_

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [ ] Review checklist passed

---

### Dependencies & Assumptions

- Depends on availability and specification of Zed ACP (protocol, client
  library, auth model).
- Assumes container can establish outbound network connections and persist small
  queues locally.
- Assumes operator will configure mapping between ACP identities and repository
  installation permissions.
````
