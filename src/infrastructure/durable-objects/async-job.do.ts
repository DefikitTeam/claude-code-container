/**
 * AsyncJobDO - Durable Object for managing async jobs
 * Stores job state and provides polling endpoint
 */

import { DurableObject } from 'cloudflare:workers';
import { AsyncJobEntity, type AsyncJobData } from '../../core/entities/async-job.entity';

export class AsyncJobDO extends DurableObject {
  /**
   * Handle HTTP requests to this Durable Object
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // GET /job/:jobId - Get job status
      if (request.method === 'GET' && path.startsWith('/job/')) {
        const jobId = path.split('/')[2];
        return await this.getJobStatus(jobId);
      }

      // POST /job - Create new job
      if (request.method === 'POST' && path === '/job') {
        const body = await request.json() as { method: string; params: any };
        return await this.createJob(body);
      }

      // PUT /job/:jobId - Update job
      if (request.method === 'PUT' && path.startsWith('/job/')) {
        const jobId = path.split('/')[2];
        const body = await request.json() as Partial<AsyncJobData>;
        return await this.updateJob(jobId, body);
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      console.error('[AsyncJobDO] Error:', error);
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Internal error',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  /**
   * Get job status
   */
  private async getJobStatus(jobId: string): Promise<Response> {
    const data = await this.ctx.storage.get<AsyncJobData>(jobId);

    if (!data) {
      return new Response(
        JSON.stringify({ error: 'Job not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Create new job
   */
  private async createJob(body: { method: string; params: any }): Promise<Response> {
    const job = AsyncJobEntity.create(body.method, body.params);
    const data = job.toJSON();

    await this.ctx.storage.put(job.jobId, data);

    // Set TTL to auto-cleanup after 1 hour
    await this.ctx.storage.setAlarm(Date.now() + 60 * 60 * 1000);

    return new Response(JSON.stringify(data), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Update job status
   */
  private async updateJob(jobId: string, body: Partial<AsyncJobData>): Promise<Response> {
    const data = await this.ctx.storage.get<AsyncJobData>(jobId);

    if (!data) {
      return new Response(
        JSON.stringify({ error: 'Job not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const job = AsyncJobEntity.fromJSON(data);
    let updatedJob = job;

    if (body.status === 'processing') {
      updatedJob = job.markAsProcessing();
    } else if (body.status === 'completed' && body.result) {
      updatedJob = job.markAsCompleted(body.result);
    } else if (body.status === 'failed' && body.error) {
      updatedJob = job.markAsFailed(body.error);
    }

    const updatedData = updatedJob.toJSON();
    await this.ctx.storage.put(jobId, updatedData);

    return new Response(JSON.stringify(updatedData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Cleanup old jobs (called by alarm)
   */
  async alarm(): Promise<void> {
    console.log('[AsyncJobDO] Cleaning up old jobs');
    
    const allKeys = await this.ctx.storage.list();
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour

    for (const [key, value] of allKeys) {
      const data = value as AsyncJobData;
      if (data.updatedAt && now - data.updatedAt > maxAge) {
        await this.ctx.storage.delete(key as string);
        console.log(`[AsyncJobDO] Deleted old job: ${key}`);
      }
    }
  }
}
