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
      } catch (error: unknown) {
        if (
          (error as { code?: string })?.code === 'ENOENT' ||
          (error as { code?: string })?.code === 'ENOTFOUND'
        ) {
          continue;
        }

        const errObj = error as {
          stdout?: string;
          stderr?: string;
          message?: string;
        };

        return {
          command: candidate,
          versionStdout: errObj?.stdout ? String(errObj.stdout).trim() : null,
          versionStderr: errObj?.stderr ? String(errObj.stderr).trim() : null,
          versionError:
            typeof errObj?.message === 'string'
              ? errObj.message
              : String(error),
        };
      }
  }

  return null;
}
