# Feature Specification: Multi-project registrations under a shared GitHub installation

**Feature Branch**: `005-support-multiple-user`  
**Created**: 2025-10-06  
**Status**: Draft  
**Input**: User description: "Support multiple user registrations per GitHub installation by replacing single installation mapping with multi-record storage"

## User Scenarios & Testing *(mandatory)*

### Primary User Story
A LumiLink project owner wants to provision a second worker for the same GitHub App installation without disturbing the first worker, so they complete the registration flow and receive a distinct configuration that coexists alongside the original.

### Acceptance Scenarios
1. **Given** an existing registration that references installation `X`, **When** a project owner submits a new registration for installation `X` with a different project identity, **Then** the system issues a new user identifier and confirms that both registrations remain active.
2. **Given** multiple registrations that reference installation `X`, **When** an API request supplies `installationId=X` and a specific `userId`, **Then** the system resolves the matching registration details without affecting the others.

### Edge Cases
- What happens when a registration attempt omits the disambiguating project label or user identifier? The system should apply clear defaults or request the missing information without blocking other registrations.
- How does the system handle the removal of one registration while others remain linked to the same installation? Remaining registrations must stay accessible and operational.

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001**: The platform MUST allow multiple active user configurations to reference the same GitHub installation identifier.
- **FR-002**: The platform MUST retain each registration’s unique metadata (e.g., user identifier, optional project label, timestamps) so stakeholders can distinguish concurrent registrations.
- **FR-003**: The registration response MUST clearly communicate success for additional registrations, including the new user identifier and guidance on how to target it in subsequent API calls.
- **FR-004**: Any API that accepts an installation identifier MUST support disambiguation via user identifier and provide a predictable strategy when disambiguation is missing (e.g., explicit error or documented default).
- **FR-005**: The platform MUST preserve historical registrations during migrations so existing workers continue functioning without manual re-registration.

### Key Entities
- **Registration Record**: Represents one project’s credentials under a GitHub installation; includes unique user identifier, installation identifier, encrypted Anthropic credential reference, optional project label, status, created/updated timestamps.
- **Installation Directory**: A logical grouping that maps a GitHub installation identifier to all associated registration records, enabling retrieval, auditing, and conflict detection.

---

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

---

## Execution Status
*Updated by main() during processing*

- [x] User description parsed
- [x] Key concepts extracted
- [x] Ambiguities marked
- [x] User scenarios defined
- [x] Requirements generated
- [x] Entities identified
- [x] Review checklist passed

---
