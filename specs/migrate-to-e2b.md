# Feature Specification: Migrate Cloudflare Containers to E2B Sandboxes

**Feature**: migrate-to-e2b
**Status**: Draft
**Created**: 2025-11-25

## 1. Overview
This feature involves replacing the current Cloudflare Container-based execution environment with E2B Sandboxes. The primary goal is to overcome the limitations of the current infrastructure (short timeouts, CPU throttling, non-standard environment) and provide a robust, persistent, and standard Linux environment for the AI coding agent.

## 2. User Scenarios

### Scenario A: Agent Execution Request
1.  **Trigger**: The system determines that an AI agent needs to run to process a GitHub issue.
2.  **Action**: The system requests a new execution environment.
3.  **System Response**: The system provisions a secure, isolated E2B sandbox.
4.  **Execution**: The agent starts within the sandbox.
5.  **Interaction**: The system communicates with the agent via the Agent-Client Protocol (ACP), streaming instructions (stdin) and receiving responses (stdout).
6.  **Result**: The agent successfully executes code, installs dependencies, or runs tests without interruption.

### Scenario B: Long-Running Task
1.  **Trigger**: The agent executes a complex task (e.g., running a large test suite).
2.  **Behavior**: The environment remains active and responsive for the duration of the task (exceeding previous 30s limits).
3.  **Outcome**: The task completes successfully, and results are reported back to the system.

## 3. Functional Requirements

### 3.1 Environment Provisioning
*   **FR-01**: The system MUST be able to spawn a new isolated execution sandbox via the E2B API.
*   **FR-02**: The sandbox MUST run a standard Linux environment capable of executing Node.js applications.
*   **FR-03**: The system MUST inject or load the agent's source code into the sandbox upon initialization.

### 3.2 Agent Communication
*   **FR-04**: The system MUST establish a bidirectional communication channel with the agent process running inside the sandbox.
*   **FR-05**: The communication channel MUST support the text-based Agent-Client Protocol (ACP) used by the agent.
*   **FR-06**: The system MUST handle standard output (stdout) and standard error (stderr) streams from the agent separately.

### 3.3 Resource Management
*   **FR-07**: The system MUST explicitly terminate the sandbox session upon task completion or failure to prevent resource leakage.
*   **FR-08**: The system MUST support configurable timeouts for sandbox sessions (e.g., 1 hour) to handle stalled agents.

### 3.4 Network & Filesystem
*   **FR-09**: The sandbox environment MUST have unrestricted outbound internet access to fetch dependencies (e.g., `npm install`, `git clone`).
*   **FR-10**: The sandbox MUST provide a writable filesystem that persists for the duration of the session.

## 4. Non-Functional Requirements

### 4.1 Performance
*   **NFR-01**: Sandbox initialization time SHOULD be comparable to or faster than the current solution (target < 1s).
*   **NFR-02**: The communication latency between the orchestrator and the sandbox SHOULD NOT degrade the user experience of the interactive agent.

### 4.2 Security
*   **NFR-03**: Sensitive credentials (e.g., API keys) MUST be passed securely to the sandbox environment (e.g., via environment variables) and MUST NOT be logged.
*   **NFR-04**: Each execution session MUST be completely isolated from others; no data shall persist between sessions.

## 5. Success Criteria

*   **SC-01**: **Reliability**: 99% of valid agent execution requests result in a successfully spawned sandbox and established connection.
*   **SC-02**: **Performance**: Agent tasks that previously failed due to CPU throttling or timeouts (e.g., `npm install` of large packages) complete successfully.
*   **SC-03**: **Compatibility**: The existing Agent-Client Protocol messages are transmitted and received correctly without modification to the core agent logic.
*   **SC-04**: **Verifiability**: System logs clearly distinguish between agent internal errors and infrastructure (E2B) errors.

## 6. Assumptions & Dependencies

*   **Assumption**: The existing agent code (`container_src`) is compatible with a standard Node.js environment without Cloudflare-specific shims.
*   **Assumption**: The project has a valid E2B API key with sufficient quota.
*   **Dependency**: The `e2b` NPM package (SDK) is available and compatible with the Cloudflare Worker runtime (or the orchestration layer).
