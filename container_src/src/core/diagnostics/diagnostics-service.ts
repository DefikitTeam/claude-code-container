import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface IDiagnosticsService {
  run(opts: { workspacePath?: string; sessionId?: string }): Promise<any>; // replace any with a proper DiagnosticsResult if desired
  envDiagnostics(): Promise<Record<string, any>>;
  getAuthDiagnostics(): Promise<Record<string, any>>;
  cliDiagnostics(): Promise<Record<string, any>>;
  gitDiagnostics(workspacePath: string): Promise<Record<string, any> | null>;
}

type ExecResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
};

const DEFAULT_CLI_TIMEOUT = 10_000; // 10s
const MAX_OUTPUT = 64 * 1024; // 64 KB

export class DiagnosticsService implements IDiagnosticsService {
  constructor(_deps?: {
    // future: inject runner/logger for testing
  }) {}

  private getAuthPaths() {
    const home = os.homedir();
    const configDir = path.join(home, '.config', 'claude-code');
    const authFile = path.join(configDir, 'auth.json');
    const legacyFile = path.join(home, '.claude.json');
    return { home, configDir, authFile, legacyFile };
  }

  async envDiagnostics(): Promise<Record<string, any>> {
    return {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd(),
      runtimeMode: process.env.ACP_MODE || 'auto',
      hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
      hasGitHubToken: !!process.env.GITHUB_TOKEN,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
    };
  }

  async getAuthDiagnostics(): Promise<Record<string, any>> {
    const { authFile, legacyFile } = this.getAuthPaths();
    const diag: Record<string, any> = {
      authFile,
      legacyFile,
      authFileExists: false,
      legacyFileExists: false,
      authFileReadable: false,
    };
    try {
      await fs.access(authFile);
      diag.authFileExists = true;
      diag.authFileReadable = true;
      try {
        const body = await fs.readFile(authFile, 'utf8');
        diag.authFileContents = body.slice(0, 4096);
      } catch (e) {
        diag.authFileReadable = false;
        diag.authFileReadError = (e as Error).message;
      }
    } catch (e) {
      // file doesn't exist or inaccessible
    }
    try {
      await fs.access(legacyFile);
      diag.legacyFileExists = true;
    } catch (e) {
      // ignore
    }
    diag.hasApiKeyEnv = !!process.env.ANTHROPIC_API_KEY;
    return diag;
  }

  private execSpawn(
    cmd: string,
    args: string[],
    cwd?: string,
    timeout = DEFAULT_CLI_TIMEOUT,
  ): Promise<ExecResult> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let finished = false;

      const child = spawn(cmd, args, { cwd, env: process.env });

      const to = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGTERM');
        } catch (e) {}
      }, timeout);

      child.stdout?.on('data', (buf: Buffer) => {
        stdout += buf.toString('utf8');
        if (stdout.length > MAX_OUTPUT) stdout = stdout.slice(0, MAX_OUTPUT);
      });
      child.stderr?.on('data', (buf: Buffer) => {
        stderr += buf.toString('utf8');
        if (stderr.length > MAX_OUTPUT) stderr = stderr.slice(0, MAX_OUTPUT);
      });

      child.on('error', (err) => {
        if (finished) return;
        finished = true;
        clearTimeout(to);
        const message =
          (err as any).code === 'ENOENT'
            ? `not-found:${cmd}`
            : (err as Error).message;
        resolve({ code: null, stdout: '', stderr: message, timedOut });
      });

      child.on('close', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(to);
        resolve({
          code: code === null ? null : code,
          stdout,
          stderr,
          timedOut,
        });
      });
    });
  }

  async cliDiagnostics(): Promise<Record<string, any>> {
    const diag: Record<string, any> = {
      timestamp: new Date().toISOString(),
      claudeVersion: null as string | null,
      helpExcerpt: null as string | null,
      cliAvailable: true,
      versionResult: null as ExecResult | null,
      helpResult: null as ExecResult | null,
    };

    // Try `claude --version` then `claude --help` (best-effort)
    try {
      const ver = await this.execSpawn('claude', ['--version']);
      diag.versionResult = ver;
      if (ver.code !== null && ver.stdout)
        diag.claudeVersion = ver.stdout.trim().split('\n')[0];
      // help
      const help = await this.execSpawn('claude', ['--help']);
      diag.helpResult = help;
      if (help.stdout) diag.helpExcerpt = help.stdout.slice(0, 4096);
    } catch (e) {
      diag.cliAvailable = false;
      diag.error = (e as Error).message;
    }

    return diag;
  }

  async gitDiagnostics(
    workspacePath: string,
  ): Promise<Record<string, any> | null> {
    try {
      const gitDir = path.join(workspacePath, '.git');
      await fs.access(gitDir);

      const result: Record<string, any> = {};
      try {
        const branch = await execFileAsync(
          'git',
          ['branch', '--show-current'],
          { cwd: workspacePath },
        );
        result.currentBranch =
          (branch.stdout || '').toString().trim() || 'main';
      } catch (e) {
        result.currentBranch = 'main';
      }
      try {
        const status = await execFileAsync('git', ['status', '--porcelain'], {
          cwd: workspacePath,
        });
        result.hasUncommittedChanges =
          ((status.stdout || '') as string).trim().length > 0;
      } catch (e) {
        result.hasUncommittedChanges = false;
      }
      try {
        const remote = await execFileAsync(
          'git',
          ['remote', 'get-url', 'origin'],
          { cwd: workspacePath },
        );
        result.remoteUrl = (remote.stdout || '').toString().trim() || undefined;
      } catch (e) {
        result.remoteUrl = undefined;
      }
      try {
        const last = await execFileAsync('git', ['log', '-1', '--pretty=%B'], {
          cwd: workspacePath,
        });
        result.lastCommit = (last.stdout || '').toString().trim() || undefined;
      } catch (e) {
        result.lastCommit = undefined;
      }

      return result;
    } catch (e) {
      // Not a git repo or inaccessible
      return null;
    }
  }

  /**
   * High-level run that aggregates diagnostics: env, auth, cli, and optional git diagnostics
   */
  async run(opts: {
    workspacePath?: string;
    sessionId?: string;
  }): Promise<any> {
    const { workspacePath } = opts;
    const [env, auth, cli] = await Promise.all([
      this.envDiagnostics(),
      this.getAuthDiagnostics(),
      this.cliDiagnostics(),
    ]);

    const result: Record<string, any> = {
      env,
      auth,
      cli,
    };

    if (workspacePath) {
      result.git = await this.gitDiagnostics(workspacePath);
    }

    return result;
  }
}

export default DiagnosticsService;
