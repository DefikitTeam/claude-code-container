#!/usr/bin/env node

import { loadManagedSettings, applyEnvironmentSettings } from "./utils.js";
import minimist from 'minimist';

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

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Choose mode based on command line arguments
if (argv['http-bridge']) {
  // HTTP Bridge mode: Acts as HTTP client to communicate with remote worker
  const { runHttpBridge } = await import("./http-bridge.js");
  await runHttpBridge(argv);
} else {
  // Standard ACP mode: stdin/stdout communication (compatible with Zed)
  const { runAcp } = await import("./acp-agent.js");
  runAcp();
}

// Keep process alive
process.stdin.resume();