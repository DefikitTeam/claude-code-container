import type {
  ClaudeCallbacks,
  ClaudeResult,
  RunOptions,
} from '../../core/interfaces/services/claude.service.js';

export type ClaudeRuntimeKind = 'sdk' | 'cli' | 'http-api';

export interface ClaudeRuntimeContext {
  apiKey: string;
  workspacePath?: string;
  model?: string;
  runningAsRoot: boolean;
  disableSdk: boolean;
  disableCli: boolean;
  forceHttpApi: boolean;
  env: NodeJS.ProcessEnv;
}

export interface ClaudeAdapter {
  readonly name: ClaudeRuntimeKind;
  canHandle(context: ClaudeRuntimeContext): Promise<boolean> | boolean;
  run(
    prompt: string,
    runOptions: RunOptions,
    context: ClaudeRuntimeContext,
    callbacks: ClaudeCallbacks,
    abortSignal: AbortSignal,
  ): Promise<ClaudeResult>;
}
