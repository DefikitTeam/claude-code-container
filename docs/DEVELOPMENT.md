# Development Guide

## Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) package manager
- [Cloudflare account](https://dash.cloudflare.com/sign-up) with Workers enabled
- [GitHub App](https://github.com/settings/developers) created and installed
- [OpenRouter API key](https://openrouter.ai/)

## Local Setup

### 1. Clone and Install

```bash
git clone https://github.com/DefikitTeam/claude-code-container.git
cd claude-code-container
pnpm install

# Install container dependencies
cd container_src
pnpm install
cd ..
```

### 2. Environment Setup

```bash
# Copy environment template
cp .dev.vars.example .dev.vars

# Edit .dev.vars with your credentials
# Required: OPENROUTER_API_KEY
```

### 3. Build Container

```bash
cd container_src
pnpm run build
cd ..
```

### 4. Start Development Server

```bash
# Start worker dev server
pnpm run dev
```

## Project Structure

```
├── src/                    # Worker source code
│   ├── index.ts           # Entry point
│   ├── api/               # API routes
│   ├── core/              # Business logic
│   └── infrastructure/    # External services
├── container_src/          # Container source code
│   ├── src/
│   │   ├── main.ts        # Container entry
│   │   └── handlers/      # Request handlers
│   └── package.json
├── wrangler.jsonc          # Cloudflare config
└── package.json
```

## Testing

```bash
# Run all tests
pnpm test

# Run container tests
cd container_src
pnpm test
```

## Deployment

```bash
# Deploy to production
pnpm run deploy

# Deploy to staging
pnpm run deploy --env staging
```

See [DEPLOYMENT_GUIDE.md](../DEPLOYMENT_GUIDE.md) for detailed deployment
instructions.
