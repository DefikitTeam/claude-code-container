# API Specification

This is the API specification for the spec detailed in
@.agent-os/specs/2025-09-05-cloudflare-deploy-button/spec.md

> Created: 2025-09-05 Version: 1.0.0

## Endpoints

### Deploy API Endpoints

#### `POST /api/deploy/initiate`

**Purpose**: Initialize deployment process and create repository fork **Request
Body**:

```json
{
  "githubToken": "string",
  "repositoryName": "string",
  "description": "string"
}
```

**Response**:

```json
{
  "deploymentId": "string",
  "forkUrl": "string",
  "status": "initiated"
}
```

#### `POST /api/deploy/configure`

**Purpose**: Configure deployment with user credentials **Request Body**:

```json
{
  "deploymentId": "string",
  "anthropicApiKey": "string",
  "githubApp": {
    "appId": "string",
    "privateKey": "string",
    "webhookSecret": "string",
    "installationId": "string"
  },
  "cloudflareConfig": {
    "accountId": "string",
    "apiToken": "string"
  }
}
```

**Response**:

```json
{
  "deploymentId": "string",
  "status": "configured",
  "validationResults": {
    "anthropicApiKey": "valid",
    "githubApp": "valid",
    "cloudflareConfig": "valid"
  }
}
```

#### `POST /api/deploy/execute`

**Purpose**: Execute the actual deployment to Cloudflare **Request Body**:

```json
{
  "deploymentId": "string"
}
```

**Response**:

```json
{
  "deploymentId": "string",
  "status": "deploying",
  "progressUrl": "/api/deploy/status/{deploymentId}"
}
```

#### `GET /api/deploy/status/{deploymentId}`

**Purpose**: Get real-time deployment status **Response**:

```json
{
  "deploymentId": "string",
  "status": "deploying|completed|failed",
  "progress": {
    "currentStep": "string",
    "completedSteps": ["string"],
    "totalSteps": 8,
    "percentage": 75
  },
  "logs": ["string"],
  "error": "string|null",
  "result": {
    "workerUrl": "string",
    "dashboardUrl": "string"
  }
}
```

### GitHub Integration Endpoints

#### `POST /api/github/fork`

**Purpose**: Create repository fork for user **Request Body**:

```json
{
  "githubToken": "string",
  "targetName": "string",
  "description": "string"
}
```

**Response**:

```json
{
  "forkUrl": "string",
  "cloneUrl": "string",
  "defaultBranch": "string"
}
```

#### `POST /api/github/validate-app`

**Purpose**: Validate GitHub App credentials **Request Body**:

```json
{
  "appId": "string",
  "privateKey": "string",
  "installationId": "string"
}
```

**Response**:

```json
{
  "valid": true,
  "permissions": ["issues", "pull_requests", "contents"],
  "installations": ["number"]
}
```

### Cloudflare Integration Endpoints

#### `POST /api/cloudflare/validate-token`

**Purpose**: Validate Cloudflare API token and permissions **Request Body**:

```json
{
  "apiToken": "string",
  "accountId": "string"
}
```

**Response**:

```json
{
  "valid": true,
  "permissions": ["zone:read", "worker:edit"],
  "accountName": "string"
}
```

#### `POST /api/cloudflare/deploy-worker`

**Purpose**: Deploy worker to Cloudflare **Request Body**:

```json
{
  "deploymentId": "string",
  "workerName": "string",
  "environment": "production|staging"
}
```

**Response**:

```json
{
  "workerUrl": "string",
  "deploymentStatus": "success",
  "dashboardUrl": "string"
}
```

## Controllers

### DeploymentController

**Purpose**: Orchestrate the entire deployment process **Methods**:

- `initiateDeployment()`: Start deployment workflow
- `configureDeployment()`: Set up credentials and configuration
- `executeDeployment()`: Deploy to Cloudflare
- `getDeploymentStatus()`: Track deployment progress
- `handleDeploymentError()`: Error handling and recovery

### GitHubController

**Purpose**: Handle GitHub API interactions **Methods**:

- `createFork()`: Fork repository for user
- `validateGitHubApp()`: Verify GitHub App credentials
- `setupWebhook()`: Configure webhook endpoints
- `checkPermissions()`: Validate required permissions

### CloudflareController

**Purpose**: Manage Cloudflare API operations **Methods**:

- `validateCredentials()`: Verify API token and account access
- `deployWorker()`: Deploy worker to Cloudflare Workers
- `configureDurableObjects()`: Set up Durable Object bindings
- `setupCustomDomain()`: Configure custom domain (optional)

### ValidationController

**Purpose**: Validate user inputs and external service credentials **Methods**:

- `validateAnthropicApiKey()`: Test Anthropic API key
- `validateGitHubCredentials()`: Test GitHub API access
- `validateCloudflareToken()`: Test Cloudflare API access
- `validateDeploymentConfig()`: Ensure complete configuration

### ProgressController

**Purpose**: Track and report deployment progress **Methods**:

- `updateProgress()`: Update deployment status
- `logStep()`: Add step to deployment log
- `handleError()`: Process and report errors
- `notifyCompletion()`: Send completion notification
