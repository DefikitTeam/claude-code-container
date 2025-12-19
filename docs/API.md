# API Reference

## Endpoints Overview

| Endpoint          | Method | Description                      |
| ----------------- | ------ | -------------------------------- |
| `/health`         | GET    | Health check                     |
| `/config`         | POST   | Configure GitHub App credentials |
| `/webhook/github` | POST   | GitHub webhook receiver          |
| `/process`        | POST   | Direct issue processing          |
| `/prompt`         | POST   | Direct prompt API                |
| `/install`        | GET    | GitHub App installation page     |

## Health Check

```bash
curl https://your-worker.workers.dev/health
```

Response:

```json
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Direct Prompt API

Send prompts directly without creating GitHub issues:

```bash
curl -X POST https://your-worker.workers.dev/prompt \
  -H "Content-Type: application/json" \
  -d '{
    "repository": "owner/repo",
    "prompt": "Create a function that calculates fibonacci numbers",
    "branch": "main"
  }'
```

Response:

```json
{
  "success": true,
  "issueNumber": 123,
  "issueUrl": "https://github.com/owner/repo/issues/123",
  "message": "Issue created and processing started"
}
```

## GitHub Webhook

Configure your GitHub App to send webhooks to:

```
https://your-worker.workers.dev/webhook/github
```

Supported events:

- `issues.opened` - Triggers automatic processing
- `issues.labeled` - Can trigger processing based on labels
- `issue_comment.created` - Responds to comments

## Configuration Endpoint

Set GitHub App credentials:

```bash
curl -X POST https://your-worker.workers.dev/config \
  -H "Content-Type: application/json" \
  -d '{
    "appId": "your-app-id",
    "privateKey": "-----BEGIN RSA PRIVATE KEY-----\n...",
    "webhookSecret": "your-webhook-secret",
    "installationId": "your-installation-id"
  }'
```
