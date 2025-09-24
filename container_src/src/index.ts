#!/usr/bin/env node

import { loadManagedSettings, applyEnvironmentSettings } from './utils.js';
import minimist from 'minimist';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Load .dev.vars (dotenv-like) to populate process.env for local dev if not already set
function loadLocalEnvVars() {
  const candidates = [
    path.join(process.cwd(), '.dev.vars'),
    path.resolve(process.cwd(), '..', '.dev.vars'),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, 'utf8');
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
      // Only load the first existing file
      break;
    } catch (e) {
      // Non-fatal; continue
    }
  }
}

loadLocalEnvVars();

// Load managed settings and apply environment variables
const managedSettings = loadManagedSettings();
if (managedSettings) {
  applyEnvironmentSettings(managedSettings);
}

// Parse command line arguments
const argv = minimist(process.argv.slice(2));

// stdout is used to send messages to the client in ACP mode
// we redirect everything else to stderr to make sure it doesn't interfere with ACP
if (!argv['http-bridge']) {
  console.log = console.error;
  console.info = console.error;
  console.warn = console.error;
  console.debug = console.error;
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Choose mode based on command line arguments or environment
if (argv['http-bridge']) {
  // HTTP Bridge mode: Acts as HTTP client to communicate with remote worker
  const { runHttpBridge } = await import('./http-bridge.js');
  await runHttpBridge(argv);
} else if (
  argv['http-server'] ||
  process.env.ACP_MODE === 'http-server' ||
  process.env.PORT
) {
  // HTTP Server mode: For Cloudflare Workers to call the container
  const { runHttpServer } = await import('./http-server.js');
  await runHttpServer(argv);
} else {
  // Standard ACP mode: stdin/stdout communication (compatible with Zed)
  const { runAcp } = await import('./acp-agent.js');
  runAcp();
  // Keep process alive in ACP mode only
  process.stdin.resume();
}
