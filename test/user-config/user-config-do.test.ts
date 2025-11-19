import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'crypto';

vi.mock('cloudflare:workers', () => {
  class DurableObject {
    protected ctx: any;
    protected env: any;

    constructor(ctx: any, env: any) {
      this.ctx = ctx;
      this.env = env;
    }
  }

  return { DurableObject };
});

if (!globalThis.crypto) {
  // Vitest runs in Node where Web Crypto lives under crypto.webcrypto
  (globalThis as any).crypto = webcrypto;
}

import { UserConfigDO } from '../../src/user-config-do';
import { CryptoUtils } from '../../src/crypto';
import type { Env, StoredUserConfig } from '../../src/types';

class InMemoryStorage {
  private store = new Map<string, any>();

  constructor(initial: Record<string, any> = {}) {
    for (const [key, value] of Object.entries(initial)) {
      this.store.set(key, value);
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.clone(this.store.get(key));
  }

  async put(key: string, value: any): Promise<void> {
    this.store.set(key, this.clone(value));
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: { prefix?: string }): Promise<Map<string, any>> {
    const prefix = options?.prefix ?? '';
    const entries = Array.from(this.store.entries()).filter(([key]) =>
      key.startsWith(prefix),
    );
    return new Map(entries.map(([key, value]) => [key, this.clone(value)]));
  }

  async deleteAll(): Promise<void> {
    this.store.clear();
  }

  snapshot(): Map<string, any> {
    return new Map(this.store);
  }

  private clone<T>(value: T): T {
    if (value === undefined || value === null) {
      return value;
    }

    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }

    if (value instanceof ArrayBuffer) {
      return value.slice(0) as T;
    }

    if (ArrayBuffer.isView(value)) {
      return new (value.constructor as any)(value as any) as T;
    }

    return JSON.parse(JSON.stringify(value));
  }
}

interface MockDurableObjectState {
  storage: InMemoryStorage;
}

const mockEnv = {} as Env;
let storage: InMemoryStorage;
let state: MockDurableObjectState;
let durable: UserConfigDO;

const register = (body: Record<string, unknown>) =>
  durable.fetch(
    new Request('https://example.com/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

const getByInstallation = (installationId: string) =>
  durable.fetch(
    new Request(
      `https://example.com/user-by-installation?installationId=${installationId}`,
      {
        method: 'GET',
      },
    ),
  );

const deleteUser = (userId: string) =>
  durable.fetch(
    new Request(`https://example.com/user?userId=${userId}`, {
      method: 'DELETE',
    }),
  );

const storeInstallationToken = (payload: Record<string, unknown>) =>
  durable.fetch(
    new Request('https://example.com/installation-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );

const storeRegistryToken = (payload: Record<string, unknown>) =>
  durable.fetch(
    new Request('https://example.com/registry-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );

beforeEach(async () => {
  storage = new InMemoryStorage();
  state = { storage };
  durable = new UserConfigDO(state as any, mockEnv);
});

describe('UserConfigDO multi-registration support', () => {
  it('stores multiple registrations for a single installation and returns directory listing', async () => {
    const first = await register({
      installationId: '123',
      anthropicApiKey: 'sk-first',
      userId: 'user-first',
    });
    expect(first.status).toBe(201);

    const second = await register({
      installationId: '123',
      anthropicApiKey: 'sk-second',
      userId: 'user-second',
      projectLabel: 'Secondary Project',
    });

    expect(second.status).toBe(201);
    const payload = await second.json();
    expect(payload.existingRegistrations).toEqual([
      expect.objectContaining({ userId: 'user-first' }),
    ]);

    const directoryResponse = await getByInstallation('123');
    expect(directoryResponse.status).toBe(200);
    const directory = await directoryResponse.json();
    expect(directory.registrations).toHaveLength(2);
    expect(directory.registrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'user-first' }),
        expect.objectContaining({ userId: 'user-second' }),
      ]),
    );
  });

  it('migrates legacy installation mapping into directory list on read', async () => {
    const key = await CryptoUtils.generateKey();
    const exported = await CryptoUtils.exportKey(key);
    const encrypted = await CryptoUtils.encrypt(key, 'legacy-secret');

    storage = new InMemoryStorage({
      encryption_key: exported,
      'installation:legacy-install': 'legacy-user',
      'user:legacy-user': {
        userId: 'legacy-user',
        installationId: 'legacy-install',
        encryptedAnthropicApiKey: encrypted,
        repositoryAccess: [],
        created: 1000,
        updated: 1000,
        isActive: true,
      } satisfies StoredUserConfig,
    });

    state = { storage };
    durable = new UserConfigDO(state as any, mockEnv);

    const response = await getByInstallation('legacy-install');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.registrations).toHaveLength(1);
    expect(body.registrations[0]).toMatchObject({ userId: 'legacy-user' });

    const installationMapping = await storage.get<any>(
      'installation:legacy-install',
    );
    expect(installationMapping).toMatchObject({
      userIds: ['legacy-user'],
    });
  });

  it('removes user from installation directory without affecting other registrations', async () => {
    await register({
      installationId: 'shared-install',
      anthropicApiKey: 'sk-one',
      userId: 'user-one',
    });
    await register({
      installationId: 'shared-install',
      anthropicApiKey: 'sk-two',
      userId: 'user-two',
    });

    const deleteResponse = await deleteUser('user-one');
    expect(deleteResponse.status).toBe(200);

    const directoryResponse = await getByInstallation('shared-install');
    expect(directoryResponse.status).toBe(200);
    const directory = await directoryResponse.json();
    expect(directory.registrations).toHaveLength(1);
    expect(directory.registrations[0]).toMatchObject({ userId: 'user-two' });
  });

  it('cleans up cached tokens (including legacy keys) when deleting a user', async () => {
    await register({
      installationId: 'tokens-install',
      anthropicApiKey: 'sk-token',
      userId: 'token-user',
    });

    const expiry = Date.now() + 30_000;

    await storeInstallationToken({
      installationId: 'tokens-install',
      userId: 'token-user',
      token: 'cached-token',
      expiresAt: expiry,
    });

    await storeRegistryToken({
      installationId: 'tokens-install',
      userId: 'token-user',
      token: 'registry-token',
      expires_at: new Date(expiry).toISOString(),
      registry_url: 'registry.cloudflare.com',
    });

    // Legacy key should be cleared as part of deletion path
    await storage.put('token:tokens-install', {
      installationId: 'tokens-install',
      token: 'legacy-token',
      expiresAt: expiry,
    });

    const deleteResponse = await deleteUser('token-user');
    expect(deleteResponse.status).toBe(200);

    expect(
      await storage.get('token:tokens-install:token-user'),
    ).toBeUndefined();
    expect(
      await storage.get('registry-token:tokens-install:token-user'),
    ).toBeUndefined();
    expect(await storage.get('token:tokens-install')).toBeUndefined();
  });
});
