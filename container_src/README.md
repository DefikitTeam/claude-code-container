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
