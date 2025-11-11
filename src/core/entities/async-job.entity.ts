/**
 * Async Job Entity
 * Represents an asynchronous job for long-running operations
 */

export type AsyncJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface AsyncJobData {
  jobId: string;
  status: AsyncJobStatus;
  method: string;
  params: any;
  result?: any;
  error?: {
    code: string;
    message: string;
  };
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
}

export class AsyncJobEntity {
  constructor(private data: AsyncJobData) {}

  static create(method: string, params: any): AsyncJobEntity {
    const now = Date.now();
    return new AsyncJobEntity({
      jobId: `job-${now}-${Math.random().toString(36).substring(2, 9)}`,
      status: 'pending',
      method,
      params,
      createdAt: now,
      updatedAt: now,
    });
  }

  static fromJSON(data: AsyncJobData): AsyncJobEntity {
    return new AsyncJobEntity(data);
  }

  get jobId(): string {
    return this.data.jobId;
  }

  get status(): AsyncJobStatus {
    return this.data.status;
  }

  get result(): any {
    return this.data.result;
  }

  get error(): AsyncJobData['error'] {
    return this.data.error;
  }

  markAsProcessing(): AsyncJobEntity {
    return new AsyncJobEntity({
      ...this.data,
      status: 'processing',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  markAsCompleted(result: any): AsyncJobEntity {
    return new AsyncJobEntity({
      ...this.data,
      status: 'completed',
      result,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  markAsFailed(error: { code: string; message: string }): AsyncJobEntity {
    return new AsyncJobEntity({
      ...this.data,
      status: 'failed',
      error,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  toJSON(): AsyncJobData {
    return { ...this.data };
  }

  isCompleted(): boolean {
    return this.data.status === 'completed' || this.data.status === 'failed';
  }

  getDuration(): number | undefined {
    if (!this.data.startedAt) return undefined;
    const endTime = this.data.completedAt || Date.now();
    return endTime - this.data.startedAt;
  }
}
