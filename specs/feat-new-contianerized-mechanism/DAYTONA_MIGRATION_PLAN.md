# Daytona Migration Plan: A User-Story-Based Phased Rollout

This document outlines a strategic plan for migrating the project's containerized execution environment from Cloudflare Containers to Daytona Sandboxes. The plan is designed to be delivered in a series of small, independently mergeable pull requests, ensuring that the system remains in a working state at every step.

A feature flag, `USE_DAYTONA_SANDBOXES`, will be used as a safety mechanism throughout the migration.

---

### **Phase 1: The Foundation**

*   **User Story:** As a developer, I want to prepare the codebase for the Daytona migration by adding all necessary configurations, types, and interfaces, without affecting any existing functionality.
*   **Goal:** This PR is a "no-op" change at runtime. It adds all the boilerplate and foundational code required for subsequent phases. The application will continue to run using the existing Cloudflare Container implementation.
*   **Key Changes (PR #1):**
    1.  **Dependencies:** Add the `@daytonaio/sdk` to `package.json`.
    2.  **Configuration:** Add Daytona-related environment variables (`DAYTONA_API_KEY`, etc.) to `wrangler.jsonc` and `.dev.vars.example`.
    3.  **Types & Interfaces:** Define the `IDaytonaSandboxService` interface and all related types (`SandboxConfig`, `SandboxInfo`) and custom errors. This establishes the contract for the new service.
*   **Outcome:** The codebase is ready for the new Daytona implementation, but the feature is not yet active. The PR is small, low-risk, and easy to review.

---

### **Phase 2: The Skeleton**

*   **User Story:** As a developer, I want to introduce the new Daytona service and wire it up behind a feature flag, so the system is ready for the new implementation but still defaults to the old one.
*   **Goal:** Create a placeholder `DaytonaSandboxServiceImpl` and integrate it into the application's dependency injection (DI) system, controlled by the `USE_DAYTONA_SANDBOXES` feature flag.
*   **Key Changes (PR #2):**
    1.  **Service Skeleton:** Create the `DaytonaSandboxServiceImpl.ts` file with placeholder methods that throw a `NotImplementedError`.
    2.  **Feature Flag Wiring:** Modify the DI logic in `src/index.ts` to choose between `DaytonaSandboxServiceImpl` and the existing `ContainerServiceImpl` based on the feature flag. The default will be `false` (use old service).
*   **Outcome:** The new service is structurally part of the application, but its incomplete methods are never called in production. This change is purely structural and very safe to merge.

---

### **Phase 3: The First Breath - Spawning and Terminating**

*   **User Story:** As a system, I want to be able to create and destroy a Daytona sandbox, so I can manage the lifecycle of an execution environment.
*   **Goal:** Implement the most basic lifecycle operations: starting and stopping a sandbox.
*   **Key Changes (PR #3):**
    1.  **Implement `create()`:** Flesh out the `create()` method in `DaytonaSandboxServiceImpl` using the Daytona SDK.
    2.  **Implement `delete()`:** Implement the `delete()` method to clean up the sandbox.
    3.  **Tests:** Add unit and integration tests for creating and deleting a sandbox.
*   **Outcome:** The core capability of managing a sandbox's lifecycle is now functional. This can be tested in a development environment by enabling the feature flag.

---

### **Phase 4: The MVP - Executing a Task**

*   **User Story:** As an AI agent, I want to execute a command inside a Daytona sandbox and receive the result, so I can perform my assigned tasks.
*   **Goal:** Complete the minimum viable product (MVP) for the Daytona migration. This makes the new path fully functional for the primary use case.
*   **Key Changes (PR #4):**
    1.  **Implement `executeCommand()`:** Implement the method responsible for running a command inside the sandbox and returning its output, likely using `sandbox.process.executeCommand()`.
    2.  **Update Use Cases:** Modify the `ProcessPromptUseCase` to work with the generic service interface.
    3.  **End-to-End Tests:** Add integration tests that cover the full flow: create sandbox -> execute command -> get result -> delete.
*   **Outcome:** The Daytona implementation is now feature-complete for basic agent tasks. At this stage, you can begin enabling the feature flag for a small percentage of traffic or for specific test users in production.

---

### **Phase 5: The Power-Up - Handling Long-Running Tasks**

*   **User Story:** As an AI agent, I need my environment to stay active for complex, long-running tasks (like `npm install`) without being shut down prematurely.
*   **Goal:** Address the primary limitation of the old system by enabling long-running processes.
*   **Key Changes (PR #5):**
    1.  **Configurable Timeouts:** Add support for setting a longer timeout when creating a sandbox.
    2.  **Async Execution:** Use the `async: true` flag in `executeSessionCommand` to handle streaming output from long-running commands.
    3.  **Tests:** Add integration tests for tasks that run longer than the old 30-second limit.
*   **Outcome:** The new Daytona implementation now surpasses the capabilities of the old system, delivering significant new value.

---

### **Phase 6: Production Hardening**

*   **User Story:** As an operator, I want the Daytona integration to be robust, secure, and observable before it's enabled for everyone.
*   **Goal:** Add production-grade features like error handling, security, and logging.
*   **Key Changes (PR #6):**
    1.  **Retry Logic:** Implement retry mechanisms for transient Daytona API errors.
    2.  **Structured Logging:** Add detailed logs with `sandboxId` for better traceability.
    3.  **Secure Credential Handling:** Ensure sensitive data passed to the sandbox is not logged.
    4.  **Error Cleanup:** Add logic to automatically delete sandboxes if an unhandled error occurs.
*   **Outcome:** The feature is now reliable and secure enough for a full production rollout.

---

### **Phase 7: The Cleanup**

*   **User Story:** As a developer, I want to remove the old Cloudflare Container code to reduce complexity and finish the migration.
*   **Goal:** Once the Daytona implementation has been running smoothly in production for a period of time, the old code can be safely removed.
*   **Key Changes (PR #7):**
    1.  **Remove Old Code:** Delete `ContainerServiceImpl.ts` and related files.
    2.  **Remove Feature Flag:** Remove the feature flag from the DI logic, making `DaytonaSandboxServiceImpl` the default and only implementation.
    3.  **Update Config:** Clean up old container-related variables from `wrangler.jsonc`.
*   **Outcome:** The migration is complete, and the codebase is simpler and cleaner.
