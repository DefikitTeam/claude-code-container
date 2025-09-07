# Claude Code Containers

<div align="## � **Requirements**

- **Node.js 22+** (for Wrangler CLI and container compatibility)
- **Cloudflare Account** (free tier works)
- **Anthropic API Key** (for Claude integration)
- **GitHub Repository** (for automation)

---

## �🚀 One-Click Deploy 

### Method 1: Fork + Auto-Deploy (Recommended)

[![Deploy with GitHub Actions](https://img.shields.io/badge/Deploy%20with-GitHub%20Actions-2088FF?style=for-the-badge&logo=github-actions&logoColor=white)](https://github.com/DefikitTeam/claude-code-container/fork)

**Why this method?** Complex Worker projects with Containers + Durable Objects cannot be deployed via simple deploy buttons. GitHub Actions provides reliable deployment with 95%+ success rate.

**Steps:**
1. **[Fork this repository](https://github.com/DefikitTeam/claude-code-container/fork)** ← Click here
2. **Add 4 secrets** in your fork: Settings → Secrets and variables → Actions
   - `CLOUDFLARE_API_TOKEN` (from Cloudflare dashboard)
   - `CLOUDFLARE_ACCOUNT_ID` (from Cloudflare dashboard)  
   - `ANTHROPIC_API_KEY` (from Anthropic console)
   - `ENCRYPTION_KEY` (generate with: `openssl rand -hex 32`)
3. **Push any change** to trigger automatic deployment

### Method 2: Deploy Button (Limited Support)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button?repository=https://github.com/DefikitTeam/claude-code-container)](https://deploy.workers.cloudflare.com/?url=https://github.com/DefikitTeam/claude-code-container)

> ⚠️ **Known Issues**: Deploy button has ~20% success rate for complex projects. Use Fork method above for reliable deployment.ter">

**⚠️ Deploy Button Notice**: The direct deploy button has known authorization issues. [See status](./DEPLOY_BUTTON_STATUS.md) • Use **Fork + GitHub Actions** for reliable deployment.

[� Reliable Deployment Guide](./DEPLOYMENT_GUIDE.md) • [🔧 Quick Start](#quick-start-fork--github-actions) • [💡 Features](#-features)

</div>

---

## 🚀 **Quick Start: Fork + GitHub Actions** (Recommended)

### 1. Fork This Repository
Click the **"Fork"** button above to create your own copy.

### 2. Set Up Secrets
In your forked repo, go to **Settings** → **Secrets** → **Actions** and add:
- `CLOUDFLARE_API_TOKEN` - [Get here](https://dash.cloudflare.com/profile/api-tokens)
- `CLOUDFLARE_ACCOUNT_ID` - Found in Cloudflare dashboard  
- `ANTHROPIC_API_KEY` - [Get here](https://console.anthropic.com/)

### 3. Deploy
1. Go to **Actions** tab in your fork
2. Click **"Deploy to Cloudflare Workers"**  
3. Click **"Run workflow"**
4. Select `production` and run!

### 4. Complete Setup
Visit: `https://your-worker-name.workers.dev/install` to configure GitHub App.

📖 **Detailed instructions**: [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)

---

## 🚀 **Alternative: Deploy Button** (May have auth issues)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/DefikitTeam/claude-code-container)

*Note: If you get "Unauthorized" errors, use the Fork method above.*

**Automated GitHub issue processing system powered by Claude Code and Cloudflare Workers**

> 🚀 **Transform GitHub issues into pull requests automatically** - Just create an issue or send a prompt, and watch Claude Code analyze, implement, and create a pull request with the solution.

## 🌟 Features

### **Two Ways to Create Solutions:**

#### 1. **GitHub Issues (Original Flow)**
- Create issues on GitHub with your requirements
- System automatically processes them and creates pull requests
- Perfect for traditional GitHub workflows

#### 2. **Direct Prompt API (New!)**
- Send prompts directly via API endpoint
- System creates GitHub issues automatically and processes them
- Ideal for integrating with external tools, CLIs, or custom UIs

### **Core Capabilities:**
- 🤖 **AI-Powered Code Generation** using Claude Code SDK
- 🔄 **Automatic Pull Request Creation** with detailed descriptions
- 🏗️ **Multi-Repository Support** for GitHub App installations
- 🔐 **Secure Credential Management** with AES-256-GCM encryption
- 🐳 **Containerized Processing** for isolated and scalable execution
- ⚡ **Serverless Architecture** built on Cloudflare Workers
- 🔗 **Real-time Webhooks** for instant issue processing

## 🏗️ Architecture

This system uses a **multi-tier architecture** built on Cloudflare's edge infrastructure:

```
GitHub Webhooks → Worker (Hono Router) → Container (Node.js + Claude Code) → GitHub API
                      ↓
                 Durable Objects (Encrypted Storage)
```

### **Components:**
- **Worker** (`src/index.ts`): Webhook processing, routing, credential management via Hono framework
- **Container** (`container_src/src/main.ts`): HTTP server (port 8080) running Claude Code SDK + git operations
- **Durable Objects**: `GitHubAppConfigDO` (encrypted credentials), `MyContainer` (lifecycle management)

## 🚀 Quick Start Options

<div align="center">

### 🎯 Choose Your Deployment Method

</div>

### Option 1: One-Click Deploy (Recommended) ⚡

The fastest way to get your own Claude Code Container system up and running:

1. **Click the deploy button above** ☝️
2. **Fork the repository** to your GitHub account (automatic)
3. **Connect your Cloudflare account** (guided setup)
4. **Add your Anthropic API key** (secure form)
5. **Deploy!** System will be live in ~5 minutes

**Perfect for:** Quick testing, personal projects, getting started immediately

### Option 2: Use as Template 📋

Create your own repository from this template for customization:

1. **Click "Use this template"** at the top of this repository
2. **Create your new repository** 
3. **Follow the setup guide** in your new repo's README
4. **Deploy using the button** in your repository

**Perfect for:** Custom modifications, team projects, production deployments

### Option 3: Manual Setup (Advanced) 🛠️

Full control over the deployment process:

#### Prerequisites
- [Node.js](https://nodejs.org/) 22+ and npm
- [Cloudflare account](https://dash.cloudflare.com/sign-up) with Workers enabled
- [GitHub App](https://github.com/settings/developers) created and installed
- [Anthropic API key](https://console.anthropic.com/) for Claude Code

#### 1. Clone and Install

```bash
git clone https://github.com/DefikitTeam/claude-code-container.git
cd claude-code-container
npm install

# Install container dependencies
cd container_src
npm install
cd ..
```

#### 2. Environment Setup

```bash
# Copy environment template
cp .dev.vars.example .dev.vars

# Edit .dev.vars with your credentials
# Required: ANTHROPIC_API_KEY
```

#### 3. Build Container

```bash
# Build TypeScript container code
cd container_src
npm run build
cd ..
```

#### 4. Deploy

```bash
# Deploy to Cloudflare Workers
npm run deploy
```

## ⚙️ Configuration

### GitHub App Setup

1. **Create a GitHub App** at `https://github.com/settings/developers`
2. **Set permissions:**
   - Issues: Read & Write
   - Pull Requests: Read & Write
   - Contents: Read & Write
   - Metadata: Read
3. **Install the app** on your repositories
4. **Configure via API:**

```bash
curl -X POST https://your-worker.your-subdomain.workers.dev/config \
  -H "Content-Type: application/json" \
  -d '{
    "appId": "your-app-id",
    "privateKey": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----",
    "webhookSecret": "your-webhook-secret",
    "installationId": "your-installation-id"
  }'
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | ✅ | Your Anthropic API key for Claude Code |
| `GITHUB_APP_ID` | ⚠️ | GitHub App ID (can be set via `/config` endpoint) |
| `GITHUB_WEBHOOK_SECRET` | ⚠️ | Webhook secret (can be set via `/config` endpoint) |
| `ENVIRONMENT` | ❌ | Environment name (default: `development`) |
| `ENABLE_DEEP_REASONING` | ❌ | Enable advanced reasoning (default: `false`) |

## 📖 Usage

### Method 1: GitHub Issues (Traditional)

1. Go to your GitHub repository
2. Create a new issue with your requirements:
   ```
   Title: Add user authentication
   
   Description:
   Please implement user authentication using JWT tokens.
   - Add login/logout endpoints
   - Create middleware for protected routes  
   - Add user registration functionality
   ```
3. The system automatically processes the issue and creates a PR

### Method 2: Direct Prompt API (New!)

Send prompts directly to the API:

```bash
# Simple prompt
curl -X POST https://your-worker.your-subdomain.workers.dev/process-prompt \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Fix the README.md file by adding proper installation instructions and examples",
    "title": "Improve README documentation"
  }'

# With repository specification (if you have multiple repos)
curl -X POST https://your-worker.your-subdomain.workers.dev/process-prompt \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Add TypeScript types for the API responses and improve error handling",
    "repository": "username/my-repo",
    "branch": "main",
    "title": "Add TypeScript types and error handling"
  }'
```

**Prompt API Parameters:**
- `prompt` (required): Your request/requirements
- `repository` (optional): Target repo in `owner/repo` format  
- `branch` (optional): Target branch (defaults to repository default)
- `title` (optional): Issue title (auto-generated if not provided)

## 🔌 API Endpoints

| Endpoint | Method | Description |
|----------|---------|-------------|
| `/` | GET | System information |
| `/health` | GET | Health check |
| `/webhook/github` | POST | GitHub webhook endpoint |
| `/process-prompt` | POST | Process prompt directly |
| `/config` | GET/POST | GitHub App configuration |
| `/container/health` | GET | Container health check |
| **🚀 Deployment API** | | **One-Click Deploy Features** |
| `/api/deploy/initiate` | POST | **New!** Initiate repository deployment |
| `/api/deploy/configure` | POST | **New!** Configure deployment credentials |
| `/api/deploy/execute` | POST | **New!** Execute deployment process |
| `/api/deploy/status/:id` | GET | **New!** Track deployment status |

### API Response Examples

**Process Prompt Success:**
```json
{
  "success": true,
  "message": "Prompt processed successfully. Issue #42 created and resolved.",
  "issueId": 123456789,
  "issueNumber": 42,
  "issueUrl": "https://github.com/user/repo/issues/42",
  "pullRequestUrl": "https://github.com/user/repo/pull/43",
  "repository": "user/repo",
  "branch": "main"
}
```

**Process Prompt Error:**
```json
{
  "success": false,
  "error": "Repository user/nonexistent not found or not accessible"
}
```

### 🚀 Deployment API Usage

The deployment API enables the "Deploy on Cloudflare" button functionality:

**1. Initiate Deployment:**
```bash
curl -X POST https://your-worker.your-subdomain.workers.dev/api/deploy/initiate \
  -H "Content-Type: application/json" \
  -d '{
    "repositoryUrl": "https://github.com/yourusername/claudecode-modern-container"
  }'
```

**Response:**
```json
{
  "success": true,
  "deploymentId": "uuid-deployment-id",
  "status": "initiated",
  "nextStep": "configure",
  "configurationUrl": "https://your-worker.your-subdomain.workers.dev/api/deploy/configure?id=uuid-deployment-id",
  "message": "Deployment initiated. Please configure your credentials."
}
```

**2. Configure Deployment:**
```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/deploy/configure?id=uuid-deployment-id" \
  -H "Content-Type: application/json" \
  -d '{
    "anthropicApiKey": "sk-ant-your-key",
    "githubToken": "ghp_your-token", 
    "cloudflareApiToken": "your-cf-token",
    "cloudflareAccountId": "your-cf-account-id"
  }'
```

**3. Execute Deployment:**
```bash
curl -X POST "https://your-worker.your-subdomain.workers.dev/api/deploy/execute?id=uuid-deployment-id"
```

**4. Check Status:**
```bash
curl https://your-worker.your-subdomain.workers.dev/api/deploy/status/uuid-deployment-id
```

**Status Response:**
```json
{
  "success": true,
  "deployment": {
    "id": "uuid-deployment-id",
    "status": "completed",
    "progress": 100,
    "steps": {
      "fork_repository": "completed",
      "configure_secrets": "completed", 
      "deploy_worker": "completed",
      "verify_deployment": "completed"
    },
    "workerUrl": "https://uuid-deployment-id.your-subdomain.workers.dev",
    "repositoryUrl": "https://github.com/username/uuid-deployment-id-claude-code-containers"
  }
}
```

## 🛠️ Development

### Local Development

```bash
# Start development server
npm run dev

# In another terminal, test the API
curl http://localhost:8787/health
```

### Container Development

```bash
cd container_src

# Watch TypeScript changes
npm run dev

# Build for production
npm run build

# Test locally
npm start
```

### Project Structure

```
├── src/                    # Worker source code
│   ├── index.ts           # Main Hono app and routing
│   ├── types.ts           # TypeScript interfaces
│   ├── crypto.ts          # Encryption utilities
│   └── durable-objects.ts # Durable Object implementations
├── container_src/         # Container source code
│   ├── src/
│   │   ├── main.ts        # Container HTTP server
│   │   └── github_client.ts # GitHub API client
│   ├── dist/              # Compiled JavaScript (git-ignored)
│   └── package.json       # Container dependencies
├── Dockerfile             # Container image definition
├── wrangler.jsonc         # Cloudflare Workers configuration
└── package.json           # Worker dependencies
```

### Dual Package Architecture

This project uses a **dual package architecture**:
- **Root `package.json`**: Cloudflare Worker dependencies (Hono, crypto, Durable Objects)
- **Container `package.json`**: Node.js runtime dependencies (Claude Code SDK, Octokit, git)

**Always install dependencies in the correct location:**
```bash
# Worker dependencies
npm install <package>

# Container dependencies  
cd container_src && npm install <package>
```

## 🔐 Security

### Credential Management
- All GitHub credentials encrypted with **AES-256-GCM**
- Private keys and tokens stored in encrypted Durable Objects
- Automatic token refresh with 5-minute expiry buffer
- Webhook signature validation for all incoming requests

### Environment Security
- Secrets managed via Cloudflare Workers environment variables
- Container isolation prevents credential leakage
- No sensitive data in logs or error messages

## 🚀 Deployment

### Production Deployment

```bash
# Deploy to production
npm run deploy

# Deploy with specific environment
wrangler deploy --env production
```

### Environment Configuration

Update `wrangler.jsonc` for different environments:

```jsonc
{
  "env": {
    "production": {
      "name": "claude-code-containers-prod",
      "containers": [
        {
          "class_name": "MyContainer",
          "image": "./Dockerfile",
          "max_instances": 50
        }
      ]
    }
  }
}
```

## 🧪 Testing

```bash
# Test health endpoint
curl https://your-worker.your-subdomain.workers.dev/health

# Test prompt processing
curl -X POST https://your-worker.your-subdomain.workers.dev/process-prompt \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Add a simple hello world function to the main file"}'

# Test container health  
curl https://your-worker.your-subdomain.workers.dev/container/health
```

## 🔧 Troubleshooting

### Common Issues

**Container service temporarily unavailable (503)**
- Run `npm run deploy` to ensure container is provisioned
- Check Cloudflare Workers dashboard for container status
- Verify Dockerfile builds successfully

**GitHub authentication failed**
- Verify GitHub App configuration via `/config` endpoint
- Check private key format (must include `-----BEGIN/END-----` headers)
- Ensure installation ID is correct

**Claude Code API errors**
- Verify `ANTHROPIC_API_KEY` is set correctly
- Check API key has sufficient credits
- Review container logs for detailed error messages

### Debug Mode

Enable debug logging:

```bash
# Development
echo "DEBUG=*" >> .dev.vars
npm run dev

# Check logs
wrangler tail
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Development Guidelines

- Use TypeScript for type safety
- Follow the existing code structure
- Add tests for new features
- Update documentation for API changes
- Ensure container builds successfully

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Anthropic](https://anthropic.com/) for the Claude Code SDK
- [Cloudflare](https://cloudflare.com/) for Workers and Containers platform
- [GitHub](https://github.com/) for the robust API and webhook system
- [Hono](https://hono.dev/) for the lightweight web framework

---

**Built with ❤️ using Claude Code, Cloudflare Workers, and modern web technologies.**

For more information, visit the [Cloudflare Containers documentation](https://developers.cloudflare.com/containers/).
