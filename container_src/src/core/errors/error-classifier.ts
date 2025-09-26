export enum ClassifiedErrorCode {
  AuthError = 'auth_error',
  CliMissing = 'cli_missing',
  WorkspaceMissing = 'workspace_missing',
  FsPermission = 'fs_permission',
  InternalCliFailure = 'internal_cli_failure',
  Cancelled = 'cancelled',
  Unknown = 'unknown',
}

export interface ClassifiedError {
  code: ClassifiedErrorCode;
  message: string;
  isRetryable: boolean;
  // Raw underlying error for logging / debugging (not to be serialized in external API responses)
  original?: unknown;
  // Optional structured metadata (e.g., exitCode, command, patternMatched)
  meta?: Record<string, unknown>;
}

export interface ErrorPattern {
  regex: RegExp;
  code: ClassifiedErrorCode;
  isRetryable: boolean;
  deriveMessage?: (match: RegExpMatchArray) => string;
}

const PATTERNS: ErrorPattern[] = [
  // Example (to replace with real patterns on implementation phase):
  // { regex: /ENOENT:.*claude-code/ i, code: ClassifiedErrorCode.CliMissing, isRetryable: false }
];

export interface ErrorClassifierOptions {
  // Future extension: accept custom patterns for injection / testing.
  patterns?: ErrorPattern[];
  // Whether to attach original error object (default true)
  includeOriginal?: boolean;
}

export class ErrorClassifier {
  private patterns: ErrorPattern[];
  private includeOriginal: boolean;

  constructor(opts: ErrorClassifierOptions = {}) {
    this.patterns = opts.patterns ?? PATTERNS;
    this.includeOriginal = opts.includeOriginal !== false;
  }

  classify(err: unknown): ClassifiedError {
    // Attempt to mimic existing classifyClaudeError behavior from acp-handlers.ts
    try {
      const raw = (err as any)?.message
        ? String((err as any).message)
        : String(err ?? '');
      const rawLower = raw.toLowerCase();
      const stderrTail: string = (err as any)?.stderrTail || '';
      const combined = rawLower + '\n' + stderrTail.toLowerCase();

      if (combined.includes('api key') || combined.includes('authentication')) {
        return {
          code: ClassifiedErrorCode.AuthError,
          message: (err as any)?.message || String(err),
          isRetryable: false,
          original: this.includeOriginal ? err : undefined,
          meta: { matched: 'auth' },
        };
      }
      if (combined.includes('not found') && combined.includes('claude')) {
        return {
          code: ClassifiedErrorCode.CliMissing,
          message: (err as any)?.message || String(err),
          isRetryable: false,
          original: this.includeOriginal ? err : undefined,
          meta: { matched: 'claude_not_found' },
        };
      }
      if (combined.includes('not a git repository')) {
        return {
          code: ClassifiedErrorCode.WorkspaceMissing,
          message: (err as any)?.message || String(err),
          isRetryable: false,
          original: this.includeOriginal ? err : undefined,
          meta: { matched: 'not_a_git_repo' },
        };
      }
      if (
        combined.includes('permission denied') ||
        combined.includes('eacces')
      ) {
        return {
          code: ClassifiedErrorCode.FsPermission,
          message: (err as any)?.message || String(err),
          isRetryable: false,
          original: this.includeOriginal ? err : undefined,
          meta: { matched: 'fs_permission' },
        };
      }
      if (
        combined.includes('stack') ||
        combined.match(/referenceerror|typeerror|syntaxerror/)
      ) {
        return {
          code: ClassifiedErrorCode.InternalCliFailure,
          message: (err as any)?.message || String(err),
          isRetryable: false,
          original: this.includeOriginal ? err : undefined,
          meta: { matched: 'internal_error' },
        };
      }
      if (rawLower.includes('cancelled') || rawLower.includes('canceled')) {
        return {
          code: ClassifiedErrorCode.Cancelled,
          message: (err as any)?.message || String(err),
          isRetryable: false,
          original: this.includeOriginal ? err : undefined,
          meta: { matched: 'cancelled' },
        };
      }

      return {
        code: ClassifiedErrorCode.Unknown,
        message: (err as any)?.message || String(err),
        isRetryable: false,
        original: this.includeOriginal ? err : undefined,
        meta: { matched: 'fallback' },
      };
    } catch (e) {
      return {
        code: ClassifiedErrorCode.Unknown,
        message: 'Error classification failed',
        isRetryable: false,
        original: this.includeOriginal ? err : undefined,
        meta: { classifyFailure: String(e) },
      };
    }
  }
}

export const defaultErrorClassifier = new ErrorClassifier();

export default ErrorClassifier;
