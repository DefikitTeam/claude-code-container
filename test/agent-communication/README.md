# Agent Communication Test Execution Guide

## Quick Start

### 1. Set up the testing environment:
```bash
./test-agent-communication.sh
```

### 2. Run the full test suite:
```bash
cd test/agent-communication
npm install
npm run test:full-suite
```

### 3. View test results:
```bash
cat test/agent-communication/logs/agent-communication-test-report.json
```

## Manual Testing Steps

### Test 1: Container Direct Communication
```bash
# Terminal 1: Start container
cd container_src
npm run build
node dist/index.js

# Terminal 2: Send test messages
node test/agent-communication/claude-code/container-tester.mjs
```

### Test 2: LumiLink-BE Mock Agent
```bash
# Run the mock LumiLink-BE agent
node test/agent-communication/lumilink-be/mock-agent.mjs
```

### Test 3: End-to-End Communication
```bash
# Run the complete test suite
npm run test:all
```

## Expected Results

### ✅ Successful Test Indicators:
- Container starts without errors
- ACP handshake completes
- Messages are exchanged bidirectionally
- Sessions are created and managed properly
- Error handling works correctly
- Performance metrics are acceptable

### ❌ Common Failure Points:
- Container startup timeouts
- JSON-RPC parsing errors
- Session management failures
- Authentication issues
- Network connectivity problems

## Test Scenarios Covered

1. **Basic Connection Test** - Verifies container startup and basic message exchange
2. **ACP Handshake Test** - Tests protocol initialization and capability exchange
3. **Session Management** - Validates session creation, updates, and cleanup
4. **Bidirectional Communication** - Tests message flow in both directions
5. **Error Handling** - Verifies proper error responses and recovery
6. **Performance Metrics** - Measures response times and throughput

## Integration with LumiLink-BE

To integrate with your actual LumiLink-BE system:

1. **Replace Mock Agent** with your real LumiLink-BE agent implementation
2. **Configure Connection Settings** in your LumiLink-BE config
3. **Implement ACP Client** using the patterns shown in mock-agent.mjs
4. **Add Error Handling** and reconnection logic
5. **Configure Authentication** for production use

## Next Steps

1. Run the test suite to validate your environment
2. Review the generated test report
3. Address any failing tests
4. Integrate the communication patterns into your LumiLink-BE implementation
5. Set up monitoring and logging for production use