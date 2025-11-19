/**
 * Comprehensive workspace diagnostic utility
 * Helps identify why git doesn't detect file changes
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);

export interface DiagnosticResult {
  timestamp: string;
  workspacePath: string;
  checks: {
    directoryExists: boolean;
    isGitRepo: boolean;
    gitConfigValid: boolean;
    hasRemote: boolean;
    currentBranch: string | null;
    fileExists: string[];
    filesInWorkspace: string[];
    gitStatus: string;
    gitStatusPorcelain: string;
    untrackedFiles: string[];
    modifiedFiles: string[];
    stagedFiles: string[];
    gitIgnoreContent: string | null;
    workspacePermissions: string | null;
  };
  errors: string[];
}

async function runGit(
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await execFileAsync('git', args, { cwd });
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout || '',
      stderr: e.stderr || '',
      code: e.code || 1,
    };
  }
}

export async function diagnoseWorkspace(
  workspacePath: string,
  targetFiles?: string[],
): Promise<DiagnosticResult> {
  const result: DiagnosticResult = {
    timestamp: new Date().toISOString(),
    workspacePath,
    checks: {
      directoryExists: false,
      isGitRepo: false,
      gitConfigValid: false,
      hasRemote: false,
      currentBranch: null,
      fileExists: [],
      filesInWorkspace: [],
      gitStatus: '',
      gitStatusPorcelain: '',
      untrackedFiles: [],
      modifiedFiles: [],
      stagedFiles: [],
      gitIgnoreContent: null,
      workspacePermissions: null,
    },
    errors: [],
  };

  try {
    // 1. Check if directory exists
    try {
      await fs.access(workspacePath);
      result.checks.directoryExists = true;
    } catch (e) {
      result.errors.push(`Directory does not exist: ${workspacePath}`);
      return result;
    }

    // 2. Check workspace permissions
    try {
      const stats = await fs.stat(workspacePath);
      result.checks.workspacePermissions = `mode: ${stats.mode.toString(8)}, uid: ${stats.uid}, gid: ${stats.gid}`;
    } catch (e: any) {
      result.errors.push(`Cannot stat workspace: ${e.message}`);
    }

    // 3. List all files in workspace
    try {
      const files = await fs.readdir(workspacePath);
      result.checks.filesInWorkspace = files;
    } catch (e: any) {
      result.errors.push(`Cannot read workspace directory: ${e.message}`);
    }

    // 4. Check if it's a git repo
    try {
      await fs.access(path.join(workspacePath, '.git'));
      result.checks.isGitRepo = true;
    } catch (e) {
      result.errors.push('Not a git repository (.git directory not found)');
      return result;
    }

    // 5. Check git config
    try {
      const userNameResult = await runGit(workspacePath, [
        'config',
        'user.name',
      ]);
      const userEmailResult = await runGit(workspacePath, [
        'config',
        'user.email',
      ]);
      result.checks.gitConfigValid =
        userNameResult.code === 0 && userEmailResult.code === 0;
      if (!result.checks.gitConfigValid) {
        result.errors.push('Git user.name or user.email not configured');
      }
    } catch (e: any) {
      result.errors.push(`Git config check failed: ${e.message}`);
    }

    // 6. Check remote
    try {
      const remoteResult = await runGit(workspacePath, ['remote', '-v']);
      result.checks.hasRemote = remoteResult.stdout.trim().length > 0;
    } catch (e: any) {
      result.errors.push(`Remote check failed: ${e.message}`);
    }

    // 7. Get current branch
    try {
      const branchResult = await runGit(workspacePath, [
        'branch',
        '--show-current',
      ]);
      result.checks.currentBranch = branchResult.stdout.trim() || null;
    } catch (e: any) {
      result.errors.push(`Branch check failed: ${e.message}`);
    }

    // 8. Check if target files exist
    if (targetFiles && targetFiles.length > 0) {
      for (const file of targetFiles) {
        const filePath = path.join(workspacePath, file);
        try {
          await fs.access(filePath);
          result.checks.fileExists.push(file);
        } catch (e) {
          result.errors.push(`Target file not found: ${file}`);
        }
      }
    }

    // 9. Get git status (human readable)
    try {
      const statusResult = await runGit(workspacePath, ['status']);
      result.checks.gitStatus = statusResult.stdout;
    } catch (e: any) {
      result.errors.push(`Git status failed: ${e.message}`);
    }

    // 10. Get git status --porcelain
    try {
      const statusResult = await runGit(workspacePath, [
        'status',
        '--porcelain',
      ]);
      result.checks.gitStatusPorcelain = statusResult.stdout;

      // Parse porcelain output
      const lines = statusResult.stdout.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        const status = line.substring(0, 2);
        const file = line.substring(3);

        if (status.includes('?')) {
          result.checks.untrackedFiles.push(file);
        }
        if (status[0] !== ' ' && status[0] !== '?') {
          result.checks.stagedFiles.push(file);
        }
        if (status[1] !== ' ' && status[1] !== '?') {
          result.checks.modifiedFiles.push(file);
        }
      }
    } catch (e: any) {
      result.errors.push(`Git status --porcelain failed: ${e.message}`);
    }

    // 11. Check .gitignore
    try {
      const gitignorePath = path.join(workspacePath, '.gitignore');
      const content = await fs.readFile(gitignorePath, 'utf-8');
      result.checks.gitIgnoreContent = content;
    } catch (e) {
      // .gitignore might not exist, not an error
    }

    // 12. Check if git is ignoring target files
    if (targetFiles && targetFiles.length > 0) {
      for (const file of targetFiles) {
        try {
          const checkIgnoreResult = await runGit(workspacePath, [
            'check-ignore',
            '-v',
            file,
          ]);
          if (checkIgnoreResult.code === 0) {
            result.errors.push(
              `File is ignored by .gitignore: ${file} (${checkIgnoreResult.stdout.trim()})`,
            );
          }
        } catch (e: any) {
          // File not ignored (exit code 1 is expected)
        }
      }
    }
  } catch (e: any) {
    result.errors.push(`Unexpected error: ${e.message}`);
  }

  return result;
}

export function formatDiagnosticResult(result: DiagnosticResult): string {
  const lines: string[] = [];

  lines.push('='.repeat(80));
  lines.push('WORKSPACE DIAGNOSTIC REPORT');
  lines.push('='.repeat(80));
  lines.push(`Timestamp: ${result.timestamp}`);
  lines.push(`Workspace: ${result.workspacePath}`);
  lines.push('');

  lines.push('CHECKS:');
  lines.push(
    `  ✓ Directory Exists: ${result.checks.directoryExists ? 'YES' : 'NO'}`,
  );
  lines.push(`  ✓ Is Git Repo: ${result.checks.isGitRepo ? 'YES' : 'NO'}`);
  lines.push(
    `  ✓ Git Config Valid: ${result.checks.gitConfigValid ? 'YES' : 'NO'}`,
  );
  lines.push(`  ✓ Has Remote: ${result.checks.hasRemote ? 'YES' : 'NO'}`);
  lines.push(`  ✓ Current Branch: ${result.checks.currentBranch || 'NONE'}`);
  lines.push(
    `  ✓ Workspace Permissions: ${result.checks.workspacePermissions || 'UNKNOWN'}`,
  );
  lines.push('');

  lines.push('FILES IN WORKSPACE:');
  if (result.checks.filesInWorkspace.length === 0) {
    lines.push('  (empty)');
  } else {
    result.checks.filesInWorkspace.forEach((f) => lines.push(`  - ${f}`));
  }
  lines.push('');

  lines.push('TARGET FILES EXIST:');
  if (result.checks.fileExists.length === 0) {
    lines.push('  (none checked or none found)');
  } else {
    result.checks.fileExists.forEach((f) => lines.push(`  ✓ ${f}`));
  }
  lines.push('');

  lines.push('GIT STATUS (--porcelain):');
  if (!result.checks.gitStatusPorcelain.trim()) {
    lines.push('  (no changes)');
  } else {
    lines.push(result.checks.gitStatusPorcelain);
  }
  lines.push('');

  lines.push('UNTRACKED FILES:');
  if (result.checks.untrackedFiles.length === 0) {
    lines.push('  (none)');
  } else {
    result.checks.untrackedFiles.forEach((f) => lines.push(`  ?? ${f}`));
  }
  lines.push('');

  lines.push('MODIFIED FILES:');
  if (result.checks.modifiedFiles.length === 0) {
    lines.push('  (none)');
  } else {
    result.checks.modifiedFiles.forEach((f) => lines.push(`  M  ${f}`));
  }
  lines.push('');

  lines.push('STAGED FILES:');
  if (result.checks.stagedFiles.length === 0) {
    lines.push('  (none)');
  } else {
    result.checks.stagedFiles.forEach((f) => lines.push(`  A  ${f}`));
  }
  lines.push('');

  if (result.checks.gitIgnoreContent) {
    lines.push('.GITIGNORE CONTENT:');
    lines.push(result.checks.gitIgnoreContent);
    lines.push('');
  }

  lines.push('GIT STATUS (human readable):');
  lines.push(result.checks.gitStatus);
  lines.push('');

  if (result.errors.length > 0) {
    lines.push('ERRORS:');
    result.errors.forEach((err) => lines.push(`  ⚠️  ${err}`));
    lines.push('');
  }

  lines.push('='.repeat(80));

  return lines.join('\n');
}
