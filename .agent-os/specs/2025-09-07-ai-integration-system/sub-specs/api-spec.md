# API Specification

This is the API specification for the spec detailed in @.agent-os/specs/2025-09-07-ai-integration-system/spec.md

> Created: 2025-09-07
> Version: 1.0.0

## Endpoints

### POST /api/integration/initiate

**Purpose:** Start the integration flow for external AI systems to onboard users
**Parameters:** 
- `externalSystemId` (string): Unique identifier for the external AI system
- `userIdentifier` (string): External system's user identifier  
- `repositoryUrl` (string): Target repository URL for integration
- `callbackUrl` (string, optional): Webhook URL for status updates

**Response:** 
```json
{
  "integrationId": "uuid",
  "githubAppInstallUrl": "https://github.com/apps/app-name/installations/new",
  "status": "initiated",
  "nextStep": "install_github_app"
}
```

**Errors:** 400 (invalid parameters), 429 (rate limited), 500 (system error)

### POST /api/integration/github-callback

**Purpose:** Handle GitHub App installation completion callback
**Parameters:**
- `integrationId` (string): Integration session identifier
- `installationId` (string): GitHub App installation ID
- `repositories` (array): List of repository URLs with access

**Response:**
```json
{
  "integrationId": "uuid", 
  "status": "github_app_installed",
  "nextStep": "deploy_worker",
  "deploymentUrl": "/api/integration/deploy"
}
```

**Errors:** 404 (integration not found), 400 (invalid installation), 500 (processing error)

### POST /api/integration/deploy

**Purpose:** Trigger automated Worker deployment via GitHub Actions
**Parameters:**
- `integrationId` (string): Integration session identifier
- `anthropicApiKey` (string): User's Anthropic API key for Worker
- `workerName` (string, optional): Custom Worker name preference

**Response:**
```json
{
  "integrationId": "uuid",
  "deploymentId": "uuid", 
  "status": "deploying",
  "estimatedTime": "5-10 minutes",
  "statusUrl": "/api/integration/status/{integrationId}"
}
```

**Errors:** 400 (missing credentials), 404 (integration not found), 500 (deployment failed)

### GET /api/integration/status/{integrationId}

**Purpose:** Check integration deployment status and retrieve Worker URL
**Parameters:** 
- `integrationId` (path parameter): Integration session identifier

**Response:**
```json
{
  "integrationId": "uuid",
  "status": "completed",
  "workerUrl": "https://worker-name.subdomain.workers.dev", 
  "apiEndpoints": {
    "processPrompt": "https://worker-name.subdomain.workers.dev/process-prompt",
    "health": "https://worker-name.subdomain.workers.dev/health"
  },
  "credentials": {
    "apiKey": "worker-api-key"
  }
}
```

**Errors:** 404 (integration not found), 202 (still processing), 500 (deployment error)

### POST /api/integration/register-worker

**Purpose:** Register deployed Worker URL and complete integration setup  
**Parameters:**
- `integrationId` (string): Integration session identifier
- `workerUrl` (string): Deployed Worker URL for validation and storage
- `apiKey` (string): Generated API key for Worker authentication

**Response:**
```json
{
  "integrationId": "uuid",
  "status": "completed", 
  "registered": true,
  "workerUrl": "validated-url",
  "a2aEnabled": true
}
```

**Errors:** 400 (invalid Worker URL), 404 (integration not found), 409 (already registered)

## Controllers

### IntegrationController
- **initiate()** - Validates external system registration and creates integration session
- **handleGitHubCallback()** - Processes GitHub App installation completion and updates session state  
- **deployWorker()** - Triggers GitHub Actions deployment workflow with user credentials
- **getStatus()** - Returns current integration status with deployment progress and Worker details
- **registerWorker()** - Validates and stores Worker URL, enables Agent-to-Agent communication

### DeploymentController  
- **forkRepository()** - Creates repository fork for user deployment
- **configureSecrets()** - Injects deployment secrets into GitHub Actions workflow
- **triggerDeployment()** - Initiates GitHub Actions workflow execution
- **monitorDeployment()** - Tracks deployment progress and handles status updates
- **validateWorker()** - Confirms Worker deployment success and configuration