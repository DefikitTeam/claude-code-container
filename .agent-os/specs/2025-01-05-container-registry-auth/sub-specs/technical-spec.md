# Technical Specification

This is the technical specification for the spec detailed in
@.agent-os/specs/2025-01-05-container-registry-auth/spec.md

> Created: 2025-09-05 Version: 1.0.0

## Technical Requirements

### Authentication Flow Architecture

#### Container Registry Authentication

- **Authentication Method**: GitHub App Installation Token with container
  registry scope
- **Token Lifecycle**: 1-hour expiry with automatic refresh 5 minutes before
  expiration
- **Scope Requirements**: `contents:read`, `metadata:read`, `packages:read`,
  `packages:write`
- **Token Storage**: Encrypted in Durable Objects using AES-256-GCM encryption
- **Fallback Strategy**: Personal Access Token (PAT) support for organizations
  without GitHub App access

#### Authentication Flow Sequence

1. **Initial Authentication**: GitHub App JWT generation using stored private
   key
2. **Installation Token Request**: Exchange JWT for installation access token
   with package permissions
3. **Registry Login**: Authenticate with GitHub Container Registry using
   installation token
4. **Token Validation**: Verify token scope and permissions before container
   operations
5. **Automatic Refresh**: Background token renewal process with 5-minute buffer

#### Error Recovery Mechanisms

- **Invalid Token**: Automatic regeneration and retry (up to 3 attempts)
- **Permission Denied**: Graceful fallback to public registry or error reporting
- **Network Failures**: Exponential backoff with maximum 30-second delay
- **Rate Limiting**: Respect GitHub API rate limits with 429 response handling

### Deploy Button Integration Requirements

#### One-Click Deployment Architecture

- **Deploy Button Component**: React/HTML button component with loading states
- **Deployment Pipeline**: Cloudflare Workers deployment via Wrangler API
- **Configuration Management**: Pre-populated wrangler.jsonc with container
  settings
- **Status Tracking**: Real-time deployment status with WebSocket connection
- **Environment Variables**: Secure injection of ANTHROPIC_API_KEY and GitHub
  credentials

#### Deployment Process Flow

1. **Pre-deployment Validation**: Check for required environment variables and
   configuration
2. **Container Build**: Automated container image build and push to registry
3. **Worker Deployment**: Deploy Cloudflare Worker with container binding
4. **Service Configuration**: Configure GitHub webhook endpoints and Durable
   Object bindings
5. **Health Check**: Verify deployment success with automated health checks
6. **Rollback Capability**: Automatic rollback on deployment failure

#### UI/UX Requirements

- **Loading Indicators**: Progress bars and status messages during deployment
- **Error Display**: Clear error messages with actionable resolution steps
- **Success Confirmation**: Deployment URL and next steps display
- **Configuration Preview**: Show configuration before deployment execution
- **One-Click Retry**: Retry button for failed deployments

### Error Handling and Diagnostics

#### Container Registry Error Handling

```typescript
interface ContainerError {
  type: 'AUTHENTICATION' | 'REGISTRY' | 'PERMISSION' | 'NETWORK';
  code: string;
  message: string;
  retryable: boolean;
  retryAfter?: number;
}
```

#### Diagnostic Information Collection

- **Authentication Status**: Token validity, scope verification, expiration time
- **Registry Connectivity**: Network latency, response times, error rates
- **Container Metrics**: Build time, image size, push/pull success rates
- **Performance Monitoring**: API response times, token refresh frequency
- **Error Logging**: Structured logging with correlation IDs for tracing

#### Error Recovery Strategies

- **Token Refresh**: Automatic token renewal with exponential backoff
- **Registry Failover**: Switch between GitHub Container Registry and Docker Hub
- **Partial Deployment**: Continue with available services if some components
  fail
- **Circuit Breaker**: Temporary disable problematic services with automatic
  recovery
- **User Notification**: Clear error messages with resolution guidance

### Configuration Management

#### Environment Configuration

```typescript
interface ContainerConfig {
  registry: {
    url: string;
    namespace: string;
    credentials: EncryptedCredentials;
  };
  deployment: {
    timeout: number;
    retries: number;
    healthCheck: HealthCheckConfig;
  };
  monitoring: {
    enabled: boolean;
    endpoints: string[];
    alerting: AlertConfig;
  };
}
```

#### Configuration Validation

- **Schema Validation**: JSON schema validation for all configuration objects
- **Credential Verification**: Test authentication before storing credentials
- **Environment Checking**: Verify required environment variables are present
- **Compatibility Testing**: Validate configuration against target deployment
  platform
- **Configuration Drift Detection**: Monitor and alert on configuration changes

#### Dynamic Configuration Updates

- **Hot Reload**: Update configuration without service restart
- **Versioning**: Track configuration changes with rollback capability
- **A/B Testing**: Support for gradual configuration rollout
- **Feature Flags**: Enable/disable features via configuration
- **Environment Promotion**: Promote configuration from staging to production

### Security Considerations

#### Credential Security

- **Encryption at Rest**: AES-256-GCM encryption for all stored credentials
- **Encryption in Transit**: TLS 1.3 for all external communications
- **Key Management**: Separate encryption keys per environment with rotation
- **Access Control**: Role-based access to credentials and configuration
- **Audit Logging**: Complete audit trail of credential access and modifications

#### Container Security

- **Image Scanning**: Automated vulnerability scanning for container images
- **Base Image Security**: Use minimal, security-hardened base images
- **Runtime Security**: Read-only file systems and non-root user execution
- **Network Security**: Minimal network access with explicit allow lists
- **Secret Management**: Environment variable injection without persistent
  storage

#### API Security

- **Authentication**: GitHub App authentication with minimal required
  permissions
- **Authorization**: Validate permissions before executing operations
- **Rate Limiting**: Implement rate limiting to prevent abuse
- **Input Validation**: Comprehensive input sanitization and validation
- **CORS Policy**: Restrictive CORS policy for web-based deploy buttons

### Performance Requirements

#### Response Time Targets

- **Token Generation**: < 500ms for JWT creation and installation token exchange
- **Registry Authentication**: < 1 second for container registry login
- **Deploy Button Response**: < 2 seconds for deployment initiation
- **Status Updates**: < 100ms for deployment status queries
- **Health Checks**: < 250ms for container and worker health verification

#### Scalability Requirements

- **Concurrent Deployments**: Support 10+ simultaneous deployments
- **Token Management**: Handle 1000+ installation tokens with automatic cleanup
- **Registry Operations**: Support 100+ container pushes/pulls per hour
- **Memory Usage**: < 50MB per container instance for authentication operations
- **CPU Usage**: < 30% CPU utilization during normal operations

#### Caching Strategy

- **Token Caching**: Cache installation tokens with 55-minute TTL
- **Registry Metadata**: Cache container image metadata for 15 minutes
- **Configuration Cache**: Cache validated configuration for 1 hour
- **Health Status**: Cache health check results for 30 seconds
- **CDN Integration**: Use Cloudflare CDN for static assets and documentation

## Approach

### Implementation Strategy

#### Phase 1: Authentication Infrastructure (Week 1-2)

1. Extend `GitHubAppConfigDO` with container registry token management
2. Implement token refresh mechanism with automatic retry logic
3. Add comprehensive error handling and diagnostic logging
4. Create unit tests for authentication flows

#### Phase 2: Container Registry Integration (Week 2-3)

1. Implement GitHub Container Registry authentication
2. Add container image push/pull operations with error recovery
3. Integrate with existing container lifecycle management
4. Performance optimization and caching implementation

#### Phase 3: Deploy Button Implementation (Week 3-4)

1. Create deploy button UI component with loading states
2. Implement deployment pipeline with status tracking
3. Add configuration validation and preview functionality
4. Integration testing with existing worker deployment

#### Phase 4: Monitoring and Optimization (Week 4)

1. Implement comprehensive monitoring and alerting
2. Performance tuning and optimization
3. Security audit and penetration testing
4. Documentation and user guides

### Code Architecture

#### Authentication Service

```typescript
class ContainerRegistryAuth {
  private tokenCache: Map<string, TokenInfo>;
  private refreshQueue: Set<string>;

  async getRegistryToken(installationId: string): Promise<string>;
  async refreshToken(installationId: string): Promise<void>;
  private async validateTokenScope(token: string): Promise<boolean>;
}
```

#### Deploy Button Service

```typescript
class DeployButtonService {
  async initiateDeployment(config: DeployConfig): Promise<DeploymentId>;
  async getDeploymentStatus(id: DeploymentId): Promise<DeploymentStatus>;
  async rollbackDeployment(id: DeploymentId): Promise<void>;
}
```

#### Configuration Manager

```typescript
class ConfigurationManager {
  async validateConfig(config: ContainerConfig): Promise<ValidationResult>;
  async storeConfig(config: ContainerConfig): Promise<void>;
  async getConfig(environment: string): Promise<ContainerConfig>;
}
```

### Testing Strategy

#### Unit Testing

- Authentication flow testing with mocked GitHub API
- Configuration validation testing with invalid inputs
- Error handling testing with simulated failures
- Performance testing with concurrent operations

#### Integration Testing

- End-to-end deployment testing with real GitHub repositories
- Container registry authentication with actual credentials
- Deploy button testing with Cloudflare Workers deployment
- Cross-browser testing for deploy button UI

#### Performance Testing

- Load testing with multiple concurrent authentications
- Stress testing with high-frequency token refresh
- Memory leak testing for long-running operations
- Network latency testing with various connection speeds

## External Dependencies

### GitHub APIs

- **GitHub Apps API**: Installation token management and permissions
- **GitHub Packages API**: Container registry operations and metadata
- **GitHub REST API**: Repository access and webhook management
- **GitHub GraphQL API**: Efficient data queries for complex operations

### Cloudflare APIs

- **Workers API**: Deployment and configuration management
- **Durable Objects**: State management and credential storage
- **KV Store**: Optional caching for performance optimization
- **Analytics API**: Performance monitoring and metrics collection

### Container Technologies

- **Docker Registry API**: Container image operations and metadata
- **GitHub Container Registry**: Primary registry for container images
- **Container Runtime**: Docker-compatible runtime for local testing
- **Image Scanning**: Integration with security scanning services

### Monitoring and Observability

- **Cloudflare Analytics**: Built-in performance and usage metrics
- **External APM**: Optional integration with monitoring services
- **Logging Service**: Structured logging with correlation IDs
- **Alert Management**: Integration with notification services

### Security Services

- **Encryption Libraries**: AES-256-GCM implementation for credential encryption
- **JWT Libraries**: GitHub App authentication token generation
- **Certificate Management**: TLS certificate validation and management
- **Vulnerability Scanning**: Container image security scanning services
