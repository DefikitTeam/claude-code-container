# Claude Code Containers

**Automated GitHub issue processing system powered by Claude Code and Cloudflare
Workers**

> 🚀 **Transform GitHub issues into pull requests automatically** - Just create
> an issue or send a prompt, and watch Claude Code analyze, implement, and
> create a pull request with the solution.

[![Deploy with GitHub Actions](https://img.shields.io/badge/Deploy%20with-GitHub%20Actions-2088FF?style=for-the-badge&logo=github-actions&logoColor=white)](https://github.com/DefikitTeam/claude-code-container/fork)

---

## 🚀 Quick Start: Fork + GitHub Actions

### 1. Fork This Repository

Click the **"Fork"** button above to create your own copy.

### 2. Set Up Secrets

In your forked repo, go to **Settings** → **Secrets** → **Actions** and add:

**Required:**

- `CLOUDFLARE_API_TOKEN` -
  [Get here](https://dash.cloudflare.com/profile/api-tokens)
- `CLOUDFLARE_ACCOUNT_ID` - Found in Cloudflare dashboard
- `OPENROUTER_API_KEY` - [Get here](https://openrouter.ai/)
- `ENCRYPTION_KEY` - Generate with: `openssl rand -hex 32`

**Optional (Container Provider):**

- `CONTAINER_PROVIDER` - `cloudflare` (default) or `daytona`

**Daytona Provider Only (if `CONTAINER_PROVIDER=daytona`):**

- `DAYTONA_API_KEY` - Your Daytona API token
- `DAYTONA_ORGANIZATION_ID` - Your Daytona organization ID

> ⚠️ **IMPORTANT**: Choose your container provider carefully! Once deployed,
> switching providers will cause loss of session context and conversation
> history.

### 3. Deploy

1. Go to **Actions** tab in your fork
2. Run the **Deploy to Cloudflare Workers** workflow
3. Click **Run workflow**, choose the environment (e.g. `production`) and
   confirm
4. Wait for the workflow to complete (~2-5 minutes)

### 4. Complete Setup

Visit: `https://your-worker-name.workers.dev/install` to configure GitHub App.

---

## 📚 Documentation

- [Deployment Guide](./DEPLOYMENT_GUIDE.md) - Detailed deployment instructions
- [Architecture & Configuration](./docs/ARCHITECTURE.md) - System architecture
  and configuration
- [API Reference](./docs/API.md) - API endpoints documentation
- [Development Guide](./docs/DEVELOPMENT.md) - Local development setup
- [Container Providers](./docs/CONTAINER_PROVIDERS.md) - Cloudflare vs Daytona
  comparison

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file
for details.

## 🙏 Acknowledgments

- [Anthropic](https://anthropic.com/) for the Claude Code SDK
- [Cloudflare](https://cloudflare.com/) for Workers and Containers platform
- [GitHub](https://github.com/) for the robust API and webhook system
- [Hono](https://hono.dev/) for the lightweight web framework

---

**Built with ❤️ using Claude Code, Cloudflare Workers, and modern web
technologies.**
