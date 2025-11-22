# Claude ACP Lightweight Client

Lightweight ACP (Agent Client Protocol) client for Claude Code with remote
worker communication support.

## HTTP Server Mode

Run the modular JSON-RPC server with:

```bash
pnpm dev -- --http-server
```

## Stream Broker (POC)

This project optionally supports forwarding session events to an external Stream
Broker for realtime UI subscriptions or auditing.

Environment variables (development example):

- `STREAM_BROKER_URL` - Base URL of the Stream Broker ingestion endpoint (e.g.
  http://localhost:3000). When undefined, stream posting is disabled and the
  container only writes notifications to stdout.
- `STREAM_BROKER_KEY` - API key used for authentication with the Stream Broker
  (used as `Authorization: Bearer <KEY>` or `X-Stream-Key`).
- `STREAM_BROKER_ENABLED` - Feature flag to explicitly enable or disable broker
  posting. When not set, the container enables posting by default if
  `STREAM_BROKER_URL` is present; setting this to `0`, `false`, or `no` will
  disable broker posting even if a URL is present.

Example local dev `wrangler.jsonc` snippet (add to `env.development.vars`):

```jsonc
"env": {
	"development": {
		"vars": {
			"ENVIRONMENT": "development",
			"ENABLE_DEEP_REASONING": "false",
			"STREAM_BROKER_URL": "http://localhost:3000",
			"STREAM_BROKER_KEY": "dev-stream-key",
			"STREAM_BROKER_ENABLED": "1"
		}
	}
}
```

Notes:

- This is optional and intended for local development or POC demos.
- The container will keep writing notifications to stdout as usual; enabling
  `STREAM_BROKER_URL` will additionally make the container attempt to POST
  events non-blockingly to the broker.

The server now always uses the clean-architecture routing stack under
`src/api/http`. The legacy implementation (`http-server.legacy.ts`) and the
`--legacy-http-server` / `ACP_HTTP_SERVER_LEGACY` escape hatch have been
removed, so no additional flags are required.
