# Claude Code Containers

**Automated GitHub Issue Processing System Powered by Claude Code**

A sophisticated system built on Cloudflare Workers with containerized execution environments that automatically processes GitHub issues using AI-driven code analysis to provide intelligent solutions and pull requests.

![Claude Code Containers Architecture](https://imagedelivery.net/_yJ02hpOMj_EnGvsU2aygw/5aba1fb7-b937-46fd-fa67-138221082200/public)

## Overview

This project transforms GitHub issue management by:
- 🤖 **Automatic Issue Analysis** - AI-powered understanding of GitHub issues
- 🔧 **Code Generation & Fixes** - Intelligent solution implementation using Claude Code
- 🚀 **Automated Pull Requests** - Creates PRs with fixes and improvements
- 🔐 **Secure Credential Management** - AES-256-GCM encrypted storage
- 📦 **Containerized Execution** - Isolated processing environments
- ⚡ **Scalable Architecture** - Cloudflare Workers with global distribution

## Architecture

```
GitHub Issues → Worker (Router) → Container (Claude Code) → GitHub PR/Comments
                    ↓
               Durable Objects (Secure Storage)
```

### Core Components
- **Cloudflare Worker** - Request routing, webhook processing, GitHub integration
- **Node.js Container** - Claude Code SDK integration, git operations, workspace management
- **Durable Objects** - Encrypted credential storage and container lifecycle management

## Prerequisites

Before getting started, ensure you have:

- **Node.js 22+** installed
- **Cloudflare Account** with Workers and Containers enabled
- **GitHub App** created with proper permissions (Issues, Pull Requests, Contents: Read & Write)
- **Anthropic API Key** for Claude Code functionality

## Quick Start

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd claudecode-modern-container
npm install
```

### 2. Environment Configuration

Create `.dev.vars` file in the project root (git-ignored):

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

### 3. Install Container Dependencies

```bash
cd container_src
npm install
npm run build  # Verify TypeScript compilation
cd ..
```

### 4. Start Development Server

```bash
npm run dev
```

Open [http://localhost:8787](http://localhost:8787) to see the system status.

### 5. GitHub App Setup

1. **Create GitHub App**:
   - Go to GitHub Settings → Developer settings → GitHub Apps
   - Create new app with these permissions:
     - Issues: Read & Write
     - Pull Requests: Read & Write  
     - Contents: Read & Write
     - Metadata: Read

2. **Configure Webhook**:
   - Webhook URL: `https://your-worker.your-subdomain.workers.dev/webhook/github`
   - Content type: `application/json`
   - Events: Issues
   - Generate webhook secret

3. **Install on Repositories**:
   - Install the app on target repositories
   - Note the Installation ID from URL

### 6. Store GitHub App Configuration

Use the configuration API to securely store credentials:

```bash
curl -X POST http://localhost:8787/config \
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
# Start Worker development server
npm run dev

# In another terminal, develop container locally
cd container_src
npm run dev

# Generate types after config changes
npm run cf-typegen
```

### Testing Endpoints

```bash
# Health check
curl http://localhost:8787/health

# Container health check
curl http://localhost:8787/container/health

# Test GitHub webhook (replace signature)
curl -X POST http://localhost:8787/webhook/github \
  -H "X-GitHub-Event: ping" \
  -H "X-Hub-Signature-256: sha256=..." \
  -d '{"zen": "test"}'

# Check configuration
curl http://localhost:8787/config
```

### Container Development

The containerized environment runs Node.js with Claude Code SDK:

```bash
cd container_src

# Install dependencies
npm install

# Local development with watch mode
npm run dev

# Build TypeScript
npm run build

# Test container endpoints
curl http://localhost:8080/health
curl -X POST http://localhost:8080/process-issue \
  -H "Content-Type: application/json" \
  -d '{"type": "process_issue", "payload": {...}, "config": {...}}'
```

## API Reference

### Worker Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | System information and status |
| `/health` | GET | Health check for Worker |
| `/webhook/github` | POST | GitHub webhook endpoint |
| `/config` | GET | View GitHub App configuration (safe) |
| `/config` | POST | Store GitHub App configuration |
| `/config` | DELETE | Clear stored configuration |
| `/container/process` | POST | Direct container processing (testing) |
| `/container/health` | GET | Container health check |

### Container Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Container information |
| `/health` | GET | Container health with metrics |
| `/process-issue` | POST | Process GitHub issue with Claude Code |
| `/status` | GET | Detailed container status |

## Deployment

### Development Environment

```bash
# Deploy to development
wrangler deploy --env development
```

### Staging Environment

```bash
# Deploy to staging
wrangler deploy --env staging
```

### Production Deployment

```bash
# Deploy to production
npm run deploy
```

### Environment Variables

Set these in Cloudflare Workers dashboard:

- `ANTHROPIC_API_KEY` - Claude Code API key
- `ENVIRONMENT` - Deployment environment (production/staging/development)

## How It Works

### Issue Processing Pipeline

1. **GitHub Issue Created** → Webhook triggers Worker
2. **Signature Verification** → HMAC-SHA256 validation 
3. **Container Spawn** → Create isolated processing environment
4. **Repository Clone** → Temporary workspace with git clone
5. **Claude Code Analysis** → AI-powered issue analysis and code understanding
6. **Solution Generation** → Intelligent code fixes and improvements
7. **Branch & Commit** → Feature branch with automated commits
8. **Pull Request** → Automated PR creation with solution summary
9. **Cleanup** → Workspace cleanup and resource management

### Security Features

- **AES-256-GCM Encryption** - All credentials encrypted at rest
- **HMAC-SHA256 Verification** - GitHub webhook signature validation
- **Secure Storage** - Durable Objects with encrypted data
- **Input Validation** - Request validation and sanitization
- **Bot Detection** - Prevents infinite loops from bot-created issues

## Monitoring & Troubleshooting

### Health Checks

```bash
# Worker health
curl https://your-worker.workers.dev/health

# Container health
curl https://your-worker.workers.dev/container/health
```

### Logs

```bash
# View real-time logs
wrangler tail

# View logs with filtering
wrangler tail --format pretty --grep "ERROR"
```

### Common Issues

1. **Container won't start**: Check ANTHROPIC_API_KEY and container dependencies
2. **Webhook failures**: Verify webhook secret and GitHub App configuration
3. **Permission errors**: Ensure GitHub App has proper repository permissions
4. **Build failures**: Run TypeScript compilation in both root and container_src

### Debug Mode

Enable detailed logging:

```bash
DEBUG=* wrangler dev
```

## Configuration Files

- `wrangler.jsonc` - Cloudflare Workers configuration
- `Dockerfile` - Container image definition
- `package.json` - Worker dependencies and scripts
- `container_src/package.json` - Container dependencies
- `CLAUDE.md` - Detailed implementation guide
- `TROUBLESHOOTING_FIXES.md` - TypeScript compilation fixes

## Performance Characteristics

- **Container Memory**: 100-500MB per instance
- **Startup Time**: ~2-3 seconds (includes git clone)
- **Processing Time**: Variable based on repository size
- **Concurrency**: Up to 10 container instances
- **Global Edge**: Cloudflare's worldwide network distribution

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## Resources

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare Containers Documentation](https://developers.cloudflare.com/containers/)
- [Claude Code Documentation](https://docs.anthropic.com/claude-code)
- [GitHub Apps Documentation](https://docs.github.com/en/apps)

## License

This project is licensed under the MIT License - see the LICENSE file for details.

---

**🤖 Built with Claude Code - Automated GitHub Issue Processing System**
