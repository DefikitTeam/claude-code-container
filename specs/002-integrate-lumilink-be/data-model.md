# Data Model: LumiLink-BE ACP Protocol Integration

## Overview
This data model defines the entities and relationships required to implement the Application Communication Protocol (ACP) integration with LumiLink-BE. It extends the existing container management system with ACP-specific models while ensuring backward compatibility with HTTP-based communication.

## Core Entities

### AcpConnection

**Purpose**: Represents an active ACP connection between LumiLink-BE and a container.

**Schema**:
```prisma
model AcpConnection {
  id              String   @id @default(uuid())
  connectionId    String   @unique // External ACP identifier
  containerId     String
  container       Container @relation(fields: [containerId], references: [id], onDelete: Cascade)
  status          String   // "connected", "disconnected", "error", "reconnecting"
  version         String   // ACP protocol version e.g., "1.2.0"
  capabilities    Json?    // Negotiated capabilities
  lastActive      DateTime @updatedAt
  createdAt       DateTime @default(now())
  errorCount      Int      @default(0)
  reconnectCount  Int      @default(0)
  metadata        Json?    // Connection metadata
  
  messages        AcpMessage[]
  
  @@index([containerId])
  @@index([status])
}
```

**Validation Rules**:
- `status` must be one of: "connected", "disconnected", "error", "reconnecting"
- `version` must follow semantic versioning format
- Connection can only exist if container exists

**State Transitions**:
1. Initial: "disconnected" → "connected" (Connection established)
2. Active: "connected" → "disconnected" (Clean disconnection)
3. Error: "connected" → "error" (Connection failure)
4. Recovery: "error" → "reconnecting" → "connected" (Reconnection attempt)
5. Terminal: Any → "disconnected" (Container termination)

### ContainerSession (Modified)

**Purpose**: Extended to support different communication protocols.

**Schema Changes**:
```prisma
model ContainerSession {
  // Existing fields...
  
  // New fields
  protocolType      String   @default("http") // "http" or "acp"
  fallbackEnabled   Boolean  @default(true)   // Allow fallback to HTTP
  acpConnectionId   String?  // Current ACP connection if active
  acpConnection     AcpConnection? @relation(fields: [acpConnectionId], references: [id])
  protocolMetadata  Json?    // Protocol-specific configuration
  
  @@index([protocolType])
}
```

**Validation Rules**:
- `protocolType` must be one of: "http", "acp"
- If `protocolType` is "acp", container must support ACP protocol
- `acpConnectionId` must be populated when `protocolType` is "acp"

**State Transitions**:
1. Protocol Switch: "http" → "acp" (Migration to ACP)
2. Fallback: "acp" → "http" (Fallback when ACP fails)

### AcpMessage

**Purpose**: Records message exchanges over ACP connections for logging and debugging.

**Schema**:
```prisma
model AcpMessage {
  id            String   @id @default(uuid())
  connectionId  String
  connection    AcpConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  direction     String   // "inbound" or "outbound"
  messageType   String   // "connect", "message", "event", "command", "status", "disconnect"
  payload       Json?    // Message content (may be redacted for sensitive data)
  timestamp     DateTime @default(now())
  size          Int      // Size in bytes
  processed     Boolean  @default(false)
  processingTime Int?    // Time to process in ms
  error         Boolean  @default(false)
  errorMessage  String?  // Error message if processing failed
  
  @@index([connectionId])
  @@index([messageType])
  @@index([timestamp])
}
```

**Validation Rules**:
- `direction` must be one of: "inbound", "outbound"
- `messageType` must be one of: "connect", "message", "event", "command", "status", "disconnect"
- `size` must be positive integer

### Container (Modified)

**Purpose**: Extended to track container protocol capabilities.

**Schema Changes**:
```prisma
model Container {
  // Existing fields...
  
  // New fields
  supportedProtocols String[] @default(["http"]) // Protocols this container supports
  preferredProtocol  String   @default("http")   // Preferred protocol for this container
  acpConnections    AcpConnection[]              // All connections for this container
  
  @@index([preferredProtocol])
}
```

**Validation Rules**:
- `supportedProtocols` must contain valid protocol identifiers
- `preferredProtocol` must be one of the values in `supportedProtocols`

## Supporting Entities

### ProtocolMigration

**Purpose**: Tracks migration of containers from HTTP to ACP protocol.

**Schema**:
```prisma
model ProtocolMigration {
  id            String   @id @default(uuid())
  containerId   String
  container     Container @relation(fields: [containerId], references: [id], onDelete: Cascade)
  fromProtocol  String   // Source protocol
  toProtocol    String   // Target protocol
  startedAt     DateTime @default(now())
  completedAt   DateTime?
  success       Boolean?
  errorMessage  String?
  attemptCount  Int      @default(1)
  rollback      Boolean  @default(false) // Whether a rollback occurred
  
  @@index([containerId])
  @@index([success])
}
```

**Validation Rules**:
- `fromProtocol` and `toProtocol` must be valid protocol identifiers
- `completedAt` must be after `startedAt` if present
- `success` must be set when `completedAt` is set

### AcpConnectionConfiguration

**Purpose**: Stores ACP-specific configuration for containers.

**Schema**:
```prisma
model AcpConnectionConfiguration {
  id                String   @id @default(uuid())
  containerId       String   @unique
  container         Container @relation(fields: [containerId], references: [id], onDelete: Cascade)
  
  maxReconnectAttempts Int     @default(5)
  reconnectDelay       Int     @default(1000) // Initial delay in ms
  maxReconnectDelay    Int     @default(30000) // Max delay in ms
  idleTimeout          Int     @default(60000) // Idle timeout in ms
  keepAliveInterval    Int     @default(30000) // Keep-alive ping interval
  compressionEnabled   Boolean @default(true)
  encryptionLevel      String  @default("standard") // "none", "standard", "high"
  
  // Feature flags
  enableBulkOperations Boolean @default(true)
  enableStatusEvents   Boolean @default(true)
  enableMetrics        Boolean @default(true)
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

**Validation Rules**:
- `reconnectDelay` must be > 0 and <= `maxReconnectDelay`
- `encryptionLevel` must be one of: "none", "standard", "high"

## Relationships

1. **Container to AcpConnection**: One-to-many
   - A container can have multiple ACP connections over time
   - Only one connection can be active at a time
   
2. **AcpConnection to AcpMessage**: One-to-many
   - Each connection has multiple messages
   - Messages are ordered by timestamp
   
3. **Container to ContainerSession**: One-to-one
   - Each container has exactly one session
   - Session tracks current protocol state
   
4. **Container to ProtocolMigration**: One-to-many
   - A container can undergo multiple protocol migrations
   - Migrations track history of protocol changes
   
5. **Container to AcpConnectionConfiguration**: One-to-one
   - Each container has one ACP configuration
   - Configuration determines connection behavior

## Database Migrations

**Migration 1: Add ACP Base Schema**
- Create AcpConnection table
- Create AcpMessage table
- Add protocol fields to ContainerSession
- Add protocol fields to Container

**Migration 2: Add Supporting Entities**
- Create ProtocolMigration table
- Create AcpConnectionConfiguration table

**Migration 3: Add Indexes and Constraints**
- Add performance indexes
- Add referential integrity constraints
- Add validation triggers if needed

## Data Access Patterns

### High-Frequency Operations
- Check connection status (indexed lookup)
- Record message (append-only)
- Update connection status (status field update)

### Medium-Frequency Operations
- Query recent messages for a connection
- Check container protocol capabilities
- Retrieve connection configuration

### Low-Frequency Operations
- Protocol migration
- Historical message analysis
- Connection statistics aggregation

## Security Considerations

1. **Data Storage**
   - Sensitive payloads should be redacted in AcpMessage records
   - Connection authentication details never stored in database
   
2. **Access Control**
   - Connection operations restricted to authorized users
   - Protocol migration requires elevated permissions
   
3. **Audit Trail**
   - Protocol changes are recorded in ProtocolMigration table
   - Connection status changes tracked with timestamps