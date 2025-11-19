# Claude Code Containers - Implementation Guide

## Overview

This project implements an automated GitHub issue processing system powered by
Claude Code, built on Cloudflare Workers with containerized execution
environments. The system integrates GitHub webhooks, secure credential
management, and AI-driven code analysis to automatically respond to GitHub
issues with intelligent solutions and pull requests.

## ✅ DO

1. Update specifications when requirements change
2. Link code to specification sections in comments
3. Keep tasks.md current with progress
4. Create integration specifications for cross-module features
5. Run linters before committing (rubocop -A, pnpm lint:fix)
6. Add tests for new functionality
7. Follow project conventions in CLAUDE.md
8. Manually test your changes

## ❌ DON'T

1. Write code without a specification
2. Ignore specification constraints during implementation
3. Leave specifications outdated after changes
4. Skip the specification review process
5. Commit debugging statements or commented code
6. Use hardcoded values instead of constants
7. Expose sensitive data in logs or commits
8. Merge without passing CI checks
9. Use legacy validation patterns for schedule events
10. Create hardcoded schedule conversion logic
11. Skip frequency-specific validation requirements

## CRITICAL

- NEVER write a fallback case for graceful degradation for any function, code,
  flow,... unless explicitly specified.

## Architecture

### High-Level Architecture

```
GitHub Issues → Worker (Router) → Container (Claude Code) → GitHub PR/Comments
                    ↓
               Durable Objects (Secure Storage)
```

### Core Components

1. **Cloudflare Worker** (`src/index.ts`)
   - Request routing and GitHub integration
   - Webhook processing and authentication
   - Durable Object coordination

2. **Containerized Claude Code Environment** (`container_src/src/main.js`)
   - HTTP server on port 8080
   - Claude Code SDK integration
   - Git operations and workspace management
   - GitHub API interactions

3. **Durable Objects**
   - `GitHubAppConfigDO`: Encrypted credential storage with AES-256-GCM
   - `MyContainer`: Container lifecycle management

## Setup Instructions

### Prerequisites

1. **Cloudflare Account** with Workers and Containers enabled
2. **GitHub App** created and configured
3. **Anthropic API Key** for Claude Code
4. **Node.js 22+** for development

### Installation

1. **Clone and Install Dependencies**

   ```bash
   git clone <repository-url>
   cd claudecode-modern-container
   npm install
   ```

2. **Configure Environment Variables** Create `.dev.vars` file (git-ignored):

   ```env
   ANTHROPIC_API_KEY=your_anthropic_api_key_here
   ```

3. **Update Wrangler Configuration** The `wrangler.jsonc` is pre-configured
   with:
   - Container port 8080
   - 45-second timeout
   - Proper Durable Object bindings
   - Environment-specific configurations

### GitHub App Setup

1. **Create GitHub App**
   - Go to GitHub Settings > Developer settings > GitHub Apps
   - Create new GitHub App with these permissions:
     - Issues: Read & Write
     - Pull Requests: Read & Write
     - Contents: Read & Write
     - Metadata: Read

2. **Configure Webhook**
   - Webhook URL:
     `https://your-worker.your-subdomain.workers.dev/webhook/github`
   - Content type: `application/json`
   - Events: Issues
   - Generate and save webhook secret

3. **Install App**
   - Install the app on target repositories
   - Note the Installation ID from the URL

### Configuration Storage

Store GitHub App credentials securely using the configuration endpoint:

```bash
curl -X POST https://your-worker.your-subdomain.workers.dev/config \
  -H "Content-Type: application/json" \
  -d '{
    "appId": "your_app_id",
    "privateKey": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----",
    "webhookSecret": "your_webhook_secret",
    "installationId": "your_installation_id"
  }'
```

## Development Workflow

### Local Development

```bash
# Start local development server
npm run dev

# Generate types after config changes
npm run cf-typegen

# Test container health
curl http://localhost:8787/container/health
```

### Container Development

The container source is in `container_src/`:

```bash
cd container_src
npm install
npm run dev  # Local container development
```

### Deployment

```bash
# Deploy to production
npm run deploy

# Deploy to staging
wrangler deploy --env staging
```

## API Endpoints

### Main Worker Endpoints

- `GET /` - System information
- `GET /health` - Health check
- `POST /webhook/github` - GitHub webhook endpoint
- `GET /config` - Get GitHub App configuration (safe view)
- `POST /config` - Store GitHub App configuration
- `DELETE /config` - Clear configuration
- `POST /container/process` - Direct container processing
- `GET /container/health` - Container health check

### Container Endpoints

- `GET /` - Container information
- `GET /health` - Container health check
- `POST /process-issue` - Process GitHub issue
- `GET /status` - Container status

## Security Features

### Encryption

- AES-256-GCM encryption for sensitive credentials
- GitHub App private keys encrypted at rest
- Webhook secrets encrypted in Durable Objects
- Installation tokens cached with expiry validation

### Authentication

- GitHub webhook signature verification (HMAC-SHA256)
- GitHub App JWT authentication
- Installation access token management
- Secure credential storage

### Input Validation

- Request body validation
- Signature verification
- Bot detection to prevent loops
- Error handling and logging

## Monitoring and Logging

### Health Checks

- Worker health endpoint
- Container health with metrics
- Memory and CPU usage reporting
- Uptime tracking

### Logging

- Structured logging throughout the system
- Error tracking and reporting
- Processing status updates
- Performance metrics

## Issue Processing Pipeline

1. **Webhook Reception**: GitHub issue events trigger processing
2. **Authentication**: Webhook signature verification
3. **Container Spawn**: Create isolated container instance
4. **Environment Setup**: Temporary workspace creation with git clone
5. **Claude Code Analysis**: AI analysis of the issue and codebase
6. **Solution Generation**: AI-powered code generation and fixes
7. **Change Detection**: Git status monitoring for modifications
8. **Branch Management**: Feature branch creation and commit
9. **PR Creation**: Automated pull request with solution summary
10. **Cleanup**: Workspace cleanup and resource management

## Error Handling

### Graceful Degradation

- Container failures fallback to comment responses
- Network issues handled with retries
- Timeout management for long-running processes
- Resource cleanup on failures

### Error Recovery

- Comprehensive error logging
- Status reporting to GitHub issues
- Automatic workspace cleanup
- Container lifecycle management

## Performance Characteristics

### Resource Utilization

- Container Memory: 100-500MB per instance
- Startup Time: ~2-3 seconds (includes git clone)
- Processing Time: Variable based on repository size and complexity
- Concurrency: Up to 10 container instances

### Bottlenecks

1. Git Clone Operations: Network-dependent
2. Claude Code Processing: AI inference time
3. Container Startup: Image initialization

### Scalability

- Horizontal scaling via multiple container instances
- Load balancing across container pool
- Durable Objects for consistent state management
- Cloudflare's global edge network distribution

## Troubleshooting

### Common Issues

1. **Container Won't Start**

   ```bash
   # Check container logs
   wrangler tail

   # Verify dependencies
   npm list --depth=0
   ```

2. **GitHub Webhook Failing**

   ```bash
   # Test webhook locally
   curl -X POST http://localhost:8787/webhook/github \
     -H "X-GitHub-Event: ping" \
     -H "X-Hub-Signature-256: sha256=..." \
     -d '{"zen": "test"}'
   ```

3. **Claude Code Errors**
   - Verify ANTHROPIC_API_KEY is set
   - Check API key permissions
   - Monitor rate limits

### Debugging

```bash
# Enable debug logging
DEBUG=* wrangler dev

# Check Durable Object storage
curl https://your-worker.your-subdomain.workers.dev/config

# Test container directly
curl -X POST https://your-worker.your-subdomain.workers.dev/container/process \
  -H "Content-Type: application/json" \
  -d '{"type": "process_issue", "payload": {...}, "config": {...}}'
```

## Development Commands

```bash
# Local development
npm run dev

# Type generation
npm run cf-typegen

# Deploy to production
npm run deploy

# Container development
cd container_src && npm run dev

# Build container
cd container_src && npm run build
```

## Environment Variables

### Worker Environment

- `ANTHROPIC_API_KEY`: Claude Code API key
- `ENVIRONMENT`: Deployment environment (development/staging/production)

### Container Environment

- `ANTHROPIC_API_KEY`: Passed from worker
- `NODE_ENV`: Set to production in container
- `CONTAINER_ID`: Unique container identifier

## Contributing

1. Fork the repository
2. Create feature branch
3. Implement changes with tests
4. Update documentation
5. Submit pull request

## License

This project is licensed under the MIT License.

---

_Generated and maintained by Claude Code - Automated GitHub Issue Processing
System_

## Active Technologies

- TypeScript 5.9.2, Node.js 22+
- Vercel AI SDK, OpenRouter OpenAI SDK, Anthropic Claude Code SDK

## Recent Changes

- Removed OpenHands SDK and adapter - using only Vercel AI SDK, OpenRouter
  OpenAI SDK, and Anthropic Claude Code SDK
