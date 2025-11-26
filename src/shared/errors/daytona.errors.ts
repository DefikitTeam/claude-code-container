export enum DaytonaErrorCode {
  // Creation errors
  CREATE_FAILED = 'DAYTONA_CREATE_FAILED',
  QUOTA_EXCEEDED = 'DAYTONA_QUOTA_EXCEEDED',

  // Runtime errors
  SANDBOX_NOT_FOUND = 'DAYTONA_SANDBOX_NOT_FOUND',
  SANDBOX_TIMEOUT = 'DAYTONA_SANDBOX_TIMEOUT',
  EXECUTION_FAILED = 'DAYTONA_EXECUTION_FAILED',

  // Communication errors
  CONNECTION_FAILED = 'DAYTONA_CONNECTION_FAILED',
  REQUEST_TIMEOUT = 'DAYTONA_REQUEST_TIMEOUT',

  // API errors
  INVALID_API_KEY = 'DAYTONA_INVALID_API_KEY',
  RATE_LIMITED = 'DAYTONA_RATE_LIMITED',
}

export class DaytonaSandboxError extends Error {
  constructor(
    message: string,
    public readonly code: DaytonaErrorCode,
    public readonly sandboxId?: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'DaytonaSandboxError';
  }
}
