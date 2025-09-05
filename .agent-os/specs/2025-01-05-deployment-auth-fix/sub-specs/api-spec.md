# API Specification

This is the API specification for the spec detailed in @.agent-os/specs/2025-01-05-deployment-auth-fix/spec.md

> Created: 2025-09-05
> Version: 1.0.0

## Endpoints

### New Deployment Authentication Endpoints

#### `POST /deploy/validate`
**Purpose**: Validate deployment credentials before attempting deployment

**Request**:
```json
{
  "environment": "staging|production",
  "credentials": {
    "cloudflareApiToken": "string",
    "accountId": "string"
  }
}
```

**Response**:
```json
{
  "valid": true,
  "permissions": {
    "workers": true,
    "containers": true,
    "durableObjects": true
  },
  "accountInfo": {
    "id": "string",
    "name": "string",
    "type": "free|pro|business|enterprise"
  }
}
```

**Error Codes**:
- `401`: Invalid API token
- `403`: Insufficient permissions
- `422`: Invalid account ID format

#### `POST /deploy/prepare`
**Purpose**: Prepare deployment with pre-flight checks

**Request**:
```json
{
  "environment": "staging|production",
  "config": {
    "appName": "string",
    "containerImage": "string",
    "durableObjects": ["string"],
    "environmentVars": {
      "key": "value"
    }
  }
}
```

**Response**:
```json
{
  "prepared": true,
  "deploymentId": "string",
  "checks": {
    "resources": "pass|fail",
    "quotas": "pass|fail",
    "dependencies": "pass|fail"
  },
  "estimatedCost": {
    "monthly": "number",
    "currency": "USD"
  }
}
```

**Error Codes**:
- `402`: Quota exceeded
- `409`: Resource conflict
- `424`: Dependency check failed

### Modified Deployment Endpoints

#### `POST /deploy` (Enhanced)
**Purpose**: Execute deployment with improved error handling

**Request**:
```json
{
  "deploymentId": "string",
  "environment": "staging|production",
  "options": {
    "dryRun": false,
    "rollbackOnFailure": true,
    "maxRetries": 3
  }
}
```

**Response**:
```json
{
  "deploymentId": "string",
  "status": "initiated|in_progress|completed|failed|rolled_back",
  "steps": [
    {
      "name": "string",
      "status": "pending|running|completed|failed",
      "startTime": "ISO8601",
      "endTime": "ISO8601",
      "error": "string|null"
    }
  ],
  "urls": {
    "staging": "string",
    "production": "string"
  },
  "rollbackInfo": {
    "available": true,
    "previousVersion": "string"
  }
}
```

**Error Codes**:
- `400`: Invalid deployment configuration
- `401`: Authentication failed during deployment
- `403`: Insufficient permissions for target environment
- `409`: Deployment already in progress
- `500`: Internal deployment error
- `503`: Service temporarily unavailable

### Authentication Flow Endpoints

#### `POST /auth/github-app/token`
**Purpose**: Generate installation access token for GitHub operations

**Request**:
```json
{
  "installationId": "string",
  "permissions": {
    "contents": "read|write",
    "pull_requests": "read|write",
    "issues": "read|write"
  }
}
```

**Response**:
```json
{
  "token": "string",
  "expiresAt": "ISO8601",
  "permissions": {
    "contents": "read|write",
    "pull_requests": "read|write",
    "issues": "read|write"
  }
}
```

#### `POST /auth/cloudflare/verify`
**Purpose**: Verify Cloudflare API token and permissions

**Request**:
```json
{
  "apiToken": "string",
  "requiredScopes": ["Zone:Zone:Read", "Zone:Zone Settings:Edit"]
}
```

**Response**:
```json
{
  "valid": true,
  "user": {
    "id": "string",
    "email": "string"
  },
  "scopes": ["string"],
  "accounts": [
    {
      "id": "string",
      "name": "string",
      "type": "string"
    }
  ]
}
```

### Status and Monitoring Endpoints

#### `GET /deploy/{deploymentId}/status`
**Purpose**: Get detailed deployment status

**Response**:
```json
{
  "deploymentId": "string",
  "status": "initiated|in_progress|completed|failed|rolled_back",
  "progress": {
    "current": 3,
    "total": 8,
    "percentage": 37.5
  },
  "currentStep": {
    "name": "Uploading container",
    "status": "running",
    "startTime": "ISO8601",
    "logs": ["string"]
  },
  "completedSteps": [
    {
      "name": "Validating configuration",
      "status": "completed",
      "duration": 2.1
    }
  ],
  "metadata": {
    "environment": "staging|production",
    "startTime": "ISO8601",
    "estimatedCompletion": "ISO8601"
  }
}
```

#### `GET /deploy/{deploymentId}/logs`
**Purpose**: Stream deployment logs

**Response** (Server-Sent Events):
```
data: {"timestamp": "ISO8601", "level": "info", "message": "Starting deployment validation"}
data: {"timestamp": "ISO8601", "level": "warn", "message": "Large container size detected"}
data: {"timestamp": "ISO8601", "level": "error", "message": "Authentication failed: Invalid token"}
```

#### `GET /health/deployment`
**Purpose**: Check deployment system health

**Response**:
```json
{
  "healthy": true,
  "services": {
    "cloudflare": {
      "status": "healthy",
      "responseTime": 120,
      "lastCheck": "ISO8601"
    },
    "github": {
      "status": "healthy",
      "responseTime": 85,
      "lastCheck": "ISO8601"
    },
    "container_registry": {
      "status": "degraded",
      "responseTime": 2400,
      "lastCheck": "ISO8601",
      "issues": ["High response times detected"]
    }
  },
  "activeDeployments": 2,
  "queuedDeployments": 0
}
```

### Error Handling Endpoints

#### `POST /deploy/{deploymentId}/rollback`
**Purpose**: Rollback failed deployment

**Request**:
```json
{
  "reason": "string",
  "targetVersion": "string"
}
```

**Response**:
```json
{
  "rollbackId": "string",
  "status": "initiated",
  "targetVersion": "string",
  "estimatedTime": 300
}
```

#### `POST /deploy/{deploymentId}/retry`
**Purpose**: Retry failed deployment step

**Request**:
```json
{
  "stepName": "string",
  "maxRetries": 3
}
```

**Response**:
```json
{
  "retryId": "string",
  "status": "initiated",
  "attempt": 2,
  "maxAttempts": 3
}
```

## Controllers

### DeploymentController
**Location**: `src/controllers/DeploymentController.ts`

**Methods**:
- `validateCredentials()`: Validate deployment credentials
- `prepareDeployment()`: Run pre-flight checks
- `executeDeploy()`: Execute deployment with retry logic
- `getDeploymentStatus()`: Get current deployment status
- `streamLogs()`: Stream deployment logs via SSE
- `rollbackDeployment()`: Rollback to previous version
- `retryFailedStep()`: Retry specific deployment step

### AuthController
**Location**: `src/controllers/AuthController.ts`

**Methods**:
- `generateGitHubToken()`: Create GitHub installation access token
- `verifyCloudflareToken()`: Validate Cloudflare API credentials
- `refreshTokens()`: Refresh expired authentication tokens
- `validatePermissions()`: Check required permissions

### MonitoringController
**Location**: `src/controllers/MonitoringController.ts`

**Methods**:
- `getHealthStatus()`: System health check
- `getDeploymentMetrics()`: Deployment performance metrics
- `getErrorMetrics()`: Error rates and patterns
- `getResourceUsage()`: Resource utilization stats

## Request/Response Formats

### Standard Error Response
```json
{
  "error": {
    "code": "DEPLOYMENT_AUTH_FAILED",
    "message": "Authentication failed during deployment",
    "details": {
      "step": "cloudflare_auth",
      "timestamp": "ISO8601",
      "correlationId": "string"
    },
    "retryable": true,
    "suggestedAction": "Verify API token permissions and try again"
  }
}
```

### Standard Success Response
```json
{
  "success": true,
  "data": {
    // Endpoint-specific data
  },
  "metadata": {
    "timestamp": "ISO8601",
    "version": "1.0.0",
    "correlationId": "string"
  }
}
```

## Error Codes

### Authentication Errors
- `AUTH_001`: Invalid GitHub App credentials
- `AUTH_002`: GitHub installation access denied
- `AUTH_003`: Cloudflare API token invalid
- `AUTH_004`: Insufficient Cloudflare permissions
- `AUTH_005`: Token expired during operation

### Deployment Errors
- `DEPLOY_001`: Configuration validation failed
- `DEPLOY_002`: Resource quota exceeded
- `DEPLOY_003`: Container upload failed
- `DEPLOY_004`: Durable Object deployment failed
- `DEPLOY_005`: DNS configuration failed
- `DEPLOY_006`: Health check timeout
- `DEPLOY_007`: Rollback failed

### System Errors
- `SYS_001`: Internal server error
- `SYS_002`: Service temporarily unavailable
- `SYS_003`: Rate limit exceeded
- `SYS_004`: Request timeout
- `SYS_005`: Resource not found