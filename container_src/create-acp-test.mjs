#!/usr/bin/env node

/**
 * Simple ACP test client
 * Tests the lightweight ACP agent with proper JSON-RPC protocol
 */

import { writeFileSync } from 'fs';

// Create test input file with proper ACP JSON-RPC format
const acpTestInput = JSON.stringify({
  jsonrpc: '2.0',
  method: 'initialize',
  params: {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: true
    }
  },
  id: 1
}) + '\n';

writeFileSync('acp-test-input.json', acpTestInput);

console.log('✅ Created ACP test input file: acp-test-input.json');
console.log('📋 Content:', acpTestInput);
console.log('🧪 To test: cat acp-test-input.json | node dist/index.js');
console.log('🌐 To test HTTP bridge: node dist/index.js --http-bridge --worker-url http://localhost:8787');