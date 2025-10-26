import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const AUTH_FILE_NAME = 'auth.json';
const CLAUDE_CONFIG_DIR = path.join(os.homedir(), '.config', 'claude-code');

/**
 * Ensure the claude auth file exists for SDK subprocesses.
 * Best-effort: failures are logged but not fatal.
 */
export async function ensureClaudeAuthFile(apiKey: string): Promise<void> {
  const authFilePath = path.join(CLAUDE_CONFIG_DIR, AUTH_FILE_NAME);

  try {
    await fs.access(authFilePath);
    return;
  } catch {
    // File does not exist - continue to create it.
  }

  try {
    await fs.mkdir(CLAUDE_CONFIG_DIR, { recursive: true });
    const payload = {
      api_key: apiKey,
      user_id: 'container-user',
      created_at: new Date().toISOString(),
    };

    await fs.writeFile(authFilePath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.warn('[claude-auth-helper] Failed to create auth file', error);
  }
}
