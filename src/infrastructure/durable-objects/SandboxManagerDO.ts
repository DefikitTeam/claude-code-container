import { DurableObject } from 'cloudflare:workers';
import { SandboxState } from '../../shared/types/daytona.types';

export class SandboxManagerDO extends DurableObject {
  constructor(
    ctx: DurableObjectState,
    env: Env,
  ) {
    super(ctx, env);
  }

  async getSandboxState(): Promise<SandboxState | null> {
    const state = await this.ctx.storage.get<SandboxState>('sandboxState');
    return state ?? null;
  }

  async setSandboxId(sandboxId: string): Promise<void> {
    const now = Date.now();
    const state: SandboxState = {
      sandboxId,
      status: 'running',
      devServerUrl: null,
      createdAt: now,
      lastAccessedAt: now,
    };
    await this.ctx.storage.put('sandboxState', state);
  }

  async resetSandboxState(): Promise<void> {
    await this.ctx.storage.delete('sandboxState');
  }

  async fetch(): Promise<Response> {
    return new Response('SandboxManagerDO is running', { status: 200 });
  }
}
