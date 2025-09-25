#!/usr/bin/env node

import { loadManagedSettings, applyEnvironmentSettings } from './utils.js';
import minimist from 'minimist';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .dev.vars (dotenv-like) to populate process.env for local dev if not already set
function loadLocalEnvVars() {
  // If caller explicitly points to a file, prefer it
  const explicit = process.env.DEV_VARS_PATH;
  const tryFiles: string[] = [];
  if (explicit) tryFiles.push(explicit);

  // Search from cwd upward (up to 3 levels)
  const cwd = process.cwd();
  tryFiles.push(
    path.join(cwd, '.dev.vars'),
    path.resolve(cwd, '..', '.dev.vars'),
    path.resolve(cwd, '..', '..', '.dev.vars'),
  );

  // Search relative to compiled file location as well (dist -> project root)
  // Derive __dirname equivalent for ESM
  let runtimeDir: string | null = null;
  try {
    const __filename = fileURLToPath(import.meta.url);
    runtimeDir = path.dirname(__filename);
  } catch {}
  if (runtimeDir) {
    tryFiles.push(
      path.resolve(runtimeDir, '..', '.dev.vars'),
      path.resolve(runtimeDir, '..', '..', '.dev.vars'),
      path.resolve(runtimeDir, '..', '..', '..', '.dev.vars'),
    );
  }

  // As a fallback, also support .env using the same search order
  const tryEnvFiles = tryFiles.map((p) => p.replace(/\.dev\.vars$/, '.env'));

  let loadedFrom: string | null = null;
  const candidates = [...tryFiles, ...tryEnvFiles];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, 'utf8');
      let count = 0;
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
          count++;
        }
      }
      loadedFrom = file;
      console.error(`[ENV] Loaded ${count} var(s) from ${file}. ANTHROPIC_API_KEY present: ${!!process.env.ANTHROPIC_API_KEY}`);
      break; // only load first hit
    } catch (e) {
      // Non-fatal; continue
    }
  }
  if (!loadedFrom) {
    console.error('[ENV] No .dev.vars or .env file found (searched cwd, parents, and __dirname parents)');
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
