# LumiLink-BE ACP Protocol Integration: Quick Start Guide

This guide helps you get started with the ACP protocol integration in LumiLink-BE for container communication. The ACP protocol provides significant performance improvements and new capabilities compared to the previous HTTP-based communication.

## Prerequisites

- LumiLink-BE version 2.5.0 or higher
- Node.js 20+
- Cloudflare Workers environment or local development setup
- Existing container system compatible with ACP protocol

## Installation

1. Install the required dependencies:

```bash
# Navigate to your lumilink-be project directory
cd lumilink-be

# Install ACP client package
npm install @defikitteam/claude-acp-client @zed-industries/agent-client-protocol
```

2. Apply the database migration:

```bash
npx prisma migrate dev --name add_acp_protocol_support
```

## Basic Usage

### Creating a Container with ACP Protocol

```typescript
// Import the container service
import { containerService } from '../services/container.service';

// Create a new container with ACP protocol
const container = await containerService.createContainer({
  name: 'my-acp-container',
  userId: 'user123',
  projectId: 'project456',
  resources: {
    cpu: 1,
    memory: '512MB',
    storage: '2GB'
  },
  // Specify ACP as the preferred protocol
  preferredProtocol: 'acp',
  // Enable HTTP fallback in case ACP fails
  fallbackEnabled: true
});

console.log(`Container created with ID: ${container.id}`);
console.log(`Protocol: ${container.preferredProtocol}`);
```

### Interacting with a Container via ACP

```typescript
// Import the communication service
import { containerCommunicationService } from '../services/container-communication.service';

// Send a command to the container
const result = await containerCommunicationService.executeCommand(
  containerId,
  'run_code',
  {
    language: 'python',
    code: 'print("Hello, ACP!")',
    timeout: 5000
  }
);

console.log('Command result:', result);

// Listen for real-time events from the container
containerCommunicationService.subscribeToEvents(
  containerId,
  (event) => {
    console.log(`Received event: ${event.eventType}`);
    console.log('Event data:', event.data);
  },
  { eventTypes: ['container.status', 'operation.completed'] }
);
```

### Migrating Existing Containers to ACP

```typescript
// Import the migration service
import { protocolMigrationService } from '../services/protocol-migration.service';

// Migrate a container from HTTP to ACP
const migration = await protocolMigrationService.migrateContainer({
  containerId: 'container123',
  toProtocol: 'acp',
  strategy: 'graceful',
  reason: 'performance-improvement'
});

console.log(`Migration started with ID: ${migration.id}`);

// Check migration status
const status = await protocolMigrationService.getMigrationStatus(migration.id);
console.log(`Migration status: ${status.state}`);
```

## Configuration Options

### ACP Client Configuration

```typescript
// Configure ACP client behavior globally
import { acpClientService } from '../services/acp-client.service';

acpClientService.setGlobalConfig({
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  maxReconnectDelay: 30000,
  idleTimeout: 60000,
  keepAliveInterval: 30000,
  compressionEnabled: true
});
```

### Per-Container ACP Configuration

```typescript
// Configure ACP for a specific container
import { acpConnectionService } from '../services/acp-connection.service';

await acpConnectionService.updateConnectionConfig(containerId, {
  maxReconnectAttempts: 10,
  reconnectDelay: 500,
  compressionEnabled: true,
  encryptionLevel: 'high',
  enableBulkOperations: true
});
```

## Monitoring ACP Connections

### Connection Status

```typescript
// Check connection status
const status = await acpConnectionService.getConnectionStatus(containerId);
console.log(`Connection status: ${status}`);

// Get connection metrics
const metrics = await acpConnectionService.getConnectionMetrics(containerId);
console.log(`Message count: ${metrics.messageCount}`);
console.log(`Average latency: ${metrics.averageLatency}ms`);
```

### Connection Logs

```typescript
// Get recent messages for debugging
const messages = await acpConnectionService.getRecentMessages(containerId, {
  limit: 20,
  types: ['command', 'error'],
  direction: 'both'
});

console.log(`Retrieved ${messages.length} messages`);
```

## Fallback Mechanism

The ACP integration includes automatic fallback to HTTP when ACP connections fail. This ensures backward compatibility and system reliability.

```typescript
// Configure fallback behavior
import { containerService } from '../services/container.service';

await containerService.updateContainerConfig(containerId, {
  fallbackEnabled: true,
  fallbackThreshold: {
    errorCount: 3,
    errorRate: 0.1,
    latencyIncrease: 2.0
  }
});
```

## Performance Comparison

The following table shows typical performance improvements when using ACP compared to HTTP:

| Operation | HTTP Latency | ACP Latency | Improvement |
|-----------|-------------|-------------|-------------|
| Status Check | 320ms | 35ms | 89% |
| File Operation | 580ms | 120ms | 79% |
| Command Execution | 460ms | 95ms | 79% |
| Health Ping | 210ms | 12ms | 94% |

## Troubleshooting

### Connection Issues

If you experience connection issues:

1. Check container status:
```typescript
const containerStatus = await containerService.getContainerStatus(containerId);
console.log(containerStatus);
```

2. Check connection logs:
```typescript
const connectionLogs = await acpConnectionService.getConnectionLogs(containerId);
console.log(connectionLogs);
```

3. Try reconnecting:
```typescript
await acpConnectionService.reconnect(containerId);
```

4. If all else fails, fall back to HTTP:
```typescript
await protocolMigrationService.migrateContainer({
  containerId: containerId,
  toProtocol: 'http',
  reason: 'error-recovery'
});
```

## Best Practices

1. **Always enable fallback** for critical containers.
2. **Monitor connection health** with regular status checks.
3. **Use idempotency keys** for commands that shouldn't be executed twice.
4. **Subscribe to events** instead of polling for real-time updates.
5. **Implement graceful degradation** to HTTP when ACP is not available.

## Further Resources

- [ACP Protocol Specification](https://docs.example.com/acp-protocol)
- [API Reference](https://docs.example.com/lumilink-be/api)
- [Performance Optimization Guide](https://docs.example.com/lumilink-be/performance)
- [Debugging Guide](https://docs.example.com/lumilink-be/debugging)