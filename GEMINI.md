# Claude Code Containers (LumiLink)

## Project Overview

**Claude Code Containers** is a sophisticated automated system designed to process GitHub issues using AI agents. It leverages **Cloudflare Workers** for the API and orchestration layer, and **Cloudflare Containers** to provide a secure, isolated Node.js environment where the **Claude Code** agent (and other AI tools) can execute complex tasks, run git commands, and generate code.

## Architecture

The system follows a multi-tier serverless architecture:

1.  **Cloudflare Worker (`src/`)**:
    *   **Framework**: Hono.
    *   **Role**: Entry point for GitHub webhooks (`/webhook/github`) and API requests. It handles authentication, request routing, and orchestration.
    *   **State**: Uses Durable Objects to manage configuration and session state.

2.  **Cloudflare Container (`container_src/`)**:
    *   **Runtime**: Node.js 22+.
    *   **Role**: The execution engine. It runs the AI agent (`acp-agent.ts`), performs git operations (clone, branch, commit, push), and interacts with the LLM providers (Anthropic, OpenRouter).
    *   **Communication**: Exposes an HTTP server (bridge) to communicate with the Worker.

3.  **Durable Objects**:
    *   `GitHubAppConfigDO`: Securely stores GitHub App credentials (private keys, secrets).
    *   `MyContainer`: Manages the lifecycle of the container instances.
    *   `UserConfigDO`: Manages user-specific configurations.
    *   `ACPSessionDO`: Maintains the state of active AI agent sessions.
    *   `AsyncJobDO`: Handles background job processing.

## Key Directories

*   **`/src`**: Source code for the Cloudflare Worker.
    *   `index.ts`: Main entry point.
    *   `api/`: API route handlers and controllers.
    *   `core/`: Core business logic and entities.
    *   `infrastructure/`: Adapters for external services and storage.
*   **`/container_src`**: Source code for the Containerized Application.
    *   `src/index.ts`: Entry point for the container.
    *   `src/acp-agent.ts`: Implementation of the Agent Control Protocol (ACP) agent.
    *   `src/http-server.ts`: The internal HTTP server for worker-container communication.
*   **`/specs`**: Specification documents for features and integrations.

## Development & Usage

### Prerequisites
*   Node.js 22+
*   Cloudflare Account (Workers & Containers enabled)
*   GitHub App credentials
*   Anthropic or OpenRouter API Key

### Installation

The project uses a **dual-package structure**. You must install dependencies in both the root and the container directory.

```bash
# Install Worker dependencies
npm install

# Install Container dependencies
cd container_src
npm install
```

### Running Locally

1.  **Worker Development**:
    ```bash
    npm run dev
    # Runs wrangler dev on port 8788
    ```

2.  **Container Development**:
    ```bash
    cd container_src
    npm run dev
    # Builds and runs the container code locally
    ```

### Testing

Tests are written using **Vitest**.

```bash
# Run all tests
npm test

# Run container-specific tests
cd container_src
npm test
```

### Deployment

Deploy to Cloudflare Workers:

```bash
npm run deploy
# or for production specifically
npm run deploy:prod
```

## Configuration

*   **`wrangler.jsonc`**: Main configuration for Cloudflare Workers, Durable Objects, and Containers. Defines bindings and environment variables.
*   **`.dev.vars`**: Local environment variables (API keys, secrets). **Do not commit this file.**
*   **Secrets**: Production secrets (like `OPENROUTER_API_KEY`, `GITHUB_WEBHOOK_SECRET`) should be set via `wrangler secret put` or the Cloudflare Dashboard.

## Conventions

*   **Language**: TypeScript throughout.
*   **Style**: Prettier is configured (`.prettierrc`).
*   **Package Manager**: `pnpm` is used for lockfiles (`pnpm-lock.yaml`), though `npm` commands are documented in scripts.
*   **Architecture**: Follows a clean architecture pattern (Core, Infrastructure, API layers).
