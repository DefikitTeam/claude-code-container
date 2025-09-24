#!/usr/bin/env node
/**
 * Simple line-length guard: fails (exit 1) if any tracked .ts/.js file exceeds MAX_LINES.
 * Intentionally lightweight; exclude lockfiles, generated, dist.
 */
import { globby } from 'globby';
import fs from 'node:fs/promises';

const MAX_LINES = parseInt(process.env.ACP_MAX_FILE_LINES || '500', 10);
const patterns = ['src/**/*.ts','src/**/*.js','!**/node_modules/**','!**/dist/**'];

const files = await globby(patterns, { gitignore: true });
let failed = false;
for (const file of files) {
  const text = await fs.readFile(file, 'utf8');
  const lines = text.split(/\r?\n/).length;
  if (lines > MAX_LINES) {
    console.error(`[line-limit] ${file} has ${lines} lines (limit ${MAX_LINES})`);
    failed = true;
  }
}
if (failed) {
  process.exit(1);
} else {
  console.log(`[line-limit] All files within ${MAX_LINES} lines.`);
}
