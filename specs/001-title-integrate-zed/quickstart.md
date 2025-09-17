# Quickstart: Claude Code Container as ACP Agent

## Prerequisites
- Docker or container runtime
- Claude Code container image built and available
- Zed editor with ACP support
- GitHub App credentials configured (for repository operations)

## Container Setup

### 1. Build Container with ACP Support
```bash
# Build the container with ACP interface
cd claudecode-modern-container
docker build -t claudecode-acp .

# Or use existing container if available
docker pull your-registry/claudecode-modern-container:latest
```

### 2. Test Container ACP Interface
```bash
# Test stdio JSON-RPC interface
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"0.3.1","clientCapabilities":{"editWorkspace":true}}}' | docker run -i --rm claudecode-acp

# Expected response:
# {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"0.3.1","agentCapabilities":{"editWorkspace":true,"sessionPersistence":true},"agentInfo":{"name":"Claude Code Container","version":"1.0.0"}}}
```

## Zed Editor Configuration

### 3. Configure Zed Agent
Add to Zed `settings.json`:
```json
{
  "agent_servers": {
    "Claude Code": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "ANTHROPIC_API_KEY",
        "-e", "GITHUB_TOKEN",
        "-v", "${workspaceFolder}:/workspace",
        "claudecode-acp"
      ],
      "env": {
        "ANTHROPIC_API_KEY": "your-api-key",
        "GITHUB_TOKEN": "your-github-token"
      }
    }
  }
}
```

### 4. Test ACP Workflow in Zed

1. **Open Repository in Zed**
   ```bash
   zed /path/to/your/repository
   ```

2. **Initialize ACP Session**
   - Open agent panel (Cmd+Shift+A)
   - Select "Claude Code" agent
   - Zed automatically sends initialize request

3. **Create Development Session**
   - Agent creates session with workspace context
   - Session ID: auto-generated UUID

4. **Send Prompt to Agent**
   ```
   @Claude Code: Add error handling to the main function in src/main.js
   ```

5. **Monitor Real-time Updates**
   - Agent streams thinking progress
   - Shows file modifications in real-time
   - Displays diff/patch proposals

## Manual Testing (Command Line)

### 5. Direct JSON-RPC Testing
```bash
# Create test script
cat > test-acp.sh << 'EOF'
#!/bin/bash

# Start container in interactive mode
CONTAINER_ID=$(docker run -d -i \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -v "$(pwd):/workspace" \
  claudecode-acp)

# Function to send JSON-RPC message
send_message() {
  echo "$1" | docker exec -i $CONTAINER_ID cat
}

# Initialize agent
echo "=== Initialize ==="
INIT_MSG='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"0.3.1","clientCapabilities":{"editWorkspace":true,"filesRead":true,"filesWrite":true}}}'
send_message "$INIT_MSG"

# Create session
echo "=== Create Session ==="
SESSION_MSG='{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"workspaceUri":"file:///workspace","mode":"development"}}'
send_message "$SESSION_MSG"

# Send prompt
echo "=== Send Prompt ==="
PROMPT_MSG='{"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":"test-session","content":[{"type":"text","content":"List all JavaScript files in this project"}]}}'
send_message "$PROMPT_MSG"

# Cleanup
docker stop $CONTAINER_ID
EOF

chmod +x test-acp.sh
./test-acp.sh
```

## Advanced Usage

### 6. Session Management
```bash
# Load existing session
LOAD_MSG='{"jsonrpc":"2.0","id":4,"method":"session/load","params":{"sessionId":"existing-session-id","includeHistory":true}}'

# Cancel operation
CANCEL_MSG='{"jsonrpc":"2.0","id":5,"method":"cancel","params":{"sessionId":"session-id"}}'
```

### 7. File Context Integration
```bash
# Prompt with specific file context
CONTEXT_PROMPT='{
  "jsonrpc":"2.0",
  "id":6,
  "method":"session/prompt",
  "params":{
    "sessionId":"session-id",
    "content":[{
      "type":"text",
      "content":"Fix the TypeScript errors in this file"
    }],
    "contextFiles":[
      "src/types.ts",
      "src/main.ts"
    ]
  }
}'
```

## Troubleshooting

### Common Issues

1. **Container Not Responding**
   ```bash
   # Check container logs
   docker logs <container-id>

   # Verify JSON-RPC format
   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | jq .
   ```

2. **Authentication Errors**
   ```bash
   # Verify environment variables
   docker run --rm -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" claudecode-acp \
     sh -c 'echo "API Key: ${ANTHROPIC_API_KEY:0:8}..."'
   ```

3. **Workspace Access Issues**
   ```bash
   # Check volume mounting
   docker run --rm -v "$(pwd):/workspace" claudecode-acp ls -la /workspace
   ```

4. **Zed Agent Not Found**
   - Verify `settings.json` configuration
   - Check agent command path and arguments
   - Review Zed agent panel logs (Cmd+Shift+P → "ACP: Show Logs")

### Debug Mode
```bash
# Run container with debug output
docker run -i --rm \
  -e DEBUG=1 \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -v "$(pwd):/workspace" \
  claudecode-acp
```

## Expected Behavior

✅ **Successful Flow:**
1. Zed spawns container subprocess
2. Container responds to initialize with capabilities
3. Session created with workspace context
4. Prompts processed with real-time updates
5. File modifications reflected in Zed editor

❌ **Common Failures:**
- Missing API keys → Authentication error
- Invalid JSON-RPC → Parse error response
- Workspace access denied → Permission error
- Session not found → Session error (-32000)

## Next Steps

- **Production Deployment**: Configure container orchestration
- **Advanced Features**: Enable GitHub integration, custom tools
- **Performance Tuning**: Optimize session persistence, memory usage
- **Monitoring**: Set up logging and metrics collection
