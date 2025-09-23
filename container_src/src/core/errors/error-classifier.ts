/**
 * Phase 1 Refactor: Error Classifier Placeholder
 * --------------------------------------------------
 * This module will centralize normalization of raw errors (stderr patterns,
 * thrown Error objects, child_process exit codes) into a stable structured
 * shape used by higher layers (PromptProcessor & handlers).
 *
 * DO NOT implement real logic yet — this is a scaffolding file with TODOs.
 * The implementation will be added once we begin migrating logic from
 * the monolithic `acp-handlers.ts`.
 */

// TODO(acp-refactor/phase-1): Refine / expand error codes as real patterns emerge during extraction.
export enum ClassifiedErrorCode {
  AuthError = 'auth_error',
  CliMissing = 'cli_missing',
  WorkspaceMissing = 'workspace_missing',
  FsPermission = 'fs_permission',
  InternalCliFailure = 'internal_cli_failure',
  Cancelled = 'cancelled',
  Unknown = 'unknown',
}

// TODO(acp-refactor/phase-1): Introduce discriminated union if additional metadata per code differs.
export interface ClassifiedError {
  code: ClassifiedErrorCode;
  message: string;
  isRetryable: boolean;
  // Raw underlying error for logging / debugging (not to be serialized in external API responses)
  original?: unknown;
  // Optional structured metadata (e.g., exitCode, command, patternMatched)
  meta?: Record<string, unknown>;
}

// Pattern definition placeholder for stderr / message regex catalog.
// TODO(acp-refactor/phase-1): Populate with ordered list; first match wins.
export interface ErrorPattern {
  regex: RegExp;
  code: ClassifiedErrorCode;
  isRetryable: boolean;
  deriveMessage?: (match: RegExpMatchArray) => string;
}

// TODO(acp-refactor/phase-1): Build pattern table from existing ad-hoc checks in acp-handlers.ts
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

  /**
   * Classify a thrown error or stderr blob into a normalized structure.
   *
   * TODO(acp-refactor/phase-1): Implementation steps (planned):
   *  1. Extract raw message (string) from any accepted input shape.
   *  2. Iterate ordered pattern list – first regex match produces classification.
   *  3. If none match, fall back to heuristic checks (exit codes, cancellation markers).
   *  4. Default to Unknown with non-retryable flag unless evidence suggests retry.
   *  5. Return ClassifiedError object with optional original reference.
   */
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

// Convenience singleton (optional; can be replaced with DI-managed instance later).
// TODO(acp-refactor/phase-1): Revisit once DI wiring finalized in PromptProcessor.
export const defaultErrorClassifier = new ErrorClassifier();

export default ErrorClassifier;
