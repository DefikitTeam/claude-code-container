import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const CLI_CANDIDATES = ['claude-code', 'claude'] as const;

export type CliResolution = {
  command: string;
  versionStdout?: string | null;
  versionStderr?: string | null;
  versionError?: string | null;
};

export async function resolveClaudeCli(): Promise<CliResolution | null> {
  for (const candidate of CLI_CANDIDATES) {
    try {
      const { stdout, stderr } = await execFileAsync(candidate, ['--version']);
      return {
        command: candidate,
        versionStdout: stdout ? String(stdout).trim() : null,
        versionStderr: stderr ? String(stderr).trim() : null,
      };
    } catch (error: any) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTFOUND') {
        continue;
      }

      return {
        command: candidate,
        versionStdout: error?.stdout ? String(error.stdout).trim() : null,
        versionStderr: error?.stderr ? String(error.stderr).trim() : null,
        versionError:
          typeof error?.message === 'string' ? error.message : String(error),
      };
    }
  }

  return null;
}
