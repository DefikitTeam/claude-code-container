/**
 * Refactor Placeholder (Phase 4: Diagnostics Service)
 * --------------------------------------------------

 * during the extraction phase. Keep both until logic is migrated to avoid breaking
 * existing imports.
 *
 * Responsibilities (planned):
 *  - Execute diagnostic CLI commands or internal checks.
 *  - Normalize stderr/stdout into structured diagnostics object.
 *  - Provide lightweight performance & environment metadata.
 */

export interface IDiagnosticsService {
  run(opts: { workspacePath: string; sessionId: string }): Promise<any>; // TODO: replace any with DiagnosticsResult
}

export class DiagnosticsService implements IDiagnosticsService {
  // TODO(acp-refactor/phase-4): Accept runner abstraction + logger
  constructor(_deps?: {
    run?: (
      cmd: string,
      cwd?: string,
    ) => Promise<{ stdout: string; stderr: string; code?: number }>;
  }) {}
  async run(_opts: { workspacePath: string; sessionId: string }): Promise<any> {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    throw new Error(
      'DiagnosticsService.run not implemented (refactor phase 4 placeholder)',
    );
  }
}

export default DiagnosticsService;
