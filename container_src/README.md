# Claude ACP Lightweight Client

Lightweight ACP (Agent Client Protocol) client for Claude Code with remote
worker communication support.

## HTTP Server Mode

Run the modular JSON-RPC server with:

```bash
pnpm dev -- --http-server
```

The server now always uses the clean-architecture routing stack under
`src/api/http`. The legacy implementation (`http-server.legacy.ts`) and the
`--legacy-http-server` / `ACP_HTTP_SERVER_LEGACY` escape hatch have been
removed, so no additional flags are required.

## Environment Variables

- `DAYTONA_WORKSPACE_ID` (optional) – when present the container assumes it
	is running in a persistent Daytona workspace. The workspace service stops
	treating directories as ephemeral, and the git service prefers `git pull`
	over re-cloning existing repositories.
- `WORKSPACE_ROOT` (optional) – overrides the directory used for persistent
	workspaces when `DAYTONA_WORKSPACE_ID` is set. The path is created if it
	does not already exist.

## Persistent vs Ephemeral Workspaces

- **Ephemeral (Cloudflare)** – without `DAYTONA_WORKSPACE_ID`, sessions create
	isolated directories under the temporary workspace base and clean them up
	after the session ends. Repositories are cloned from scratch each time.
- **Persistent (Daytona)** – with `DAYTONA_WORKSPACE_ID`, the workspace
	directory is reused. If a `.git` directory is detected, the git service
	fetches and pulls the configured default branch (`main` by default), which
	keeps the workspace up to date without wiping existing work.
