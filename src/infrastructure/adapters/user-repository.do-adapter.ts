/**
 * Durable Object backed user repository adapter
 * Implements IUserRepository by delegating to the USER_CONFIG_DO Durable Object
 */

import { IUserRepository } from '../../core/interfaces/repositories/user.repository';
import { UserEntity, type UserProps } from '../../core/entities/user.entity';
import { ValidationError } from '../../shared/errors/validation.error';

export const DEFAULT_USER_CONFIG_STUB = 'user-config';

interface FetchOptions {
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

export class UserRepositoryDurableObjectAdapter implements IUserRepository {
  private readonly namespace: DurableObjectNamespace;
  private readonly stubName: string;

  constructor(
    namespace: DurableObjectNamespace,
    stubName: string = DEFAULT_USER_CONFIG_STUB,
  ) {
    this.namespace = namespace;
    this.stubName = stubName;
  }

  async save(user: UserEntity): Promise<void> {
    if (!user) {
      throw new ValidationError('User entity is required');
    }

    await this.fetch({
      method: 'POST',
      path: '/user',
      body: user.getProps(),
    });
  }

  async findById(userId: string): Promise<UserEntity | null> {
    if (!userId) {
      throw new ValidationError('userId is required');
    }

    const response = await this.fetch({
      method: 'GET',
      path: '/user',
      query: { userId },
    });

    if (!response) {
      return null;
    }

    return new UserEntity(response as UserProps);
  }

  async findByInstallationId(installationId: string): Promise<UserEntity[]> {
    if (!installationId) {
      throw new ValidationError('installationId is required');
    }

    const results = await this.fetch({
      method: 'GET',
      path: '/users',
      query: { installationId },
    });

  return Array.isArray(results) ? results.map((props: UserProps) => new UserEntity(props)) : [];
  }

  async delete(userId: string): Promise<void> {
    if (!userId) {
      throw new ValidationError('userId is required');
    }

    await this.fetch({
      method: 'DELETE',
      path: '/user',
      query: { userId },
    });
  }

  async listByInstallation(installationId: string): Promise<UserEntity[]> {
    const results = await this.fetch({
      method: 'GET',
      path: '/users',
      query: { installationId, activeOnly: 'true' },
    });

    return Array.isArray(results) ? results.map((props: UserProps) => new UserEntity(props)) : [];
  }

  private async fetch<T extends unknown>(options: FetchOptions): Promise<T | null> {
    const id = this.namespace.idFromName(this.stubName);
    const stub = this.namespace.get(id);

    const url = new URL(`https://user-config${options.path}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, value);
      }
    }

    const init: RequestInit = {
      method: options.method,
      headers: { 'Content-Type': 'application/json' },
    };

    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }

    const response = await stub.fetch(new Request(url.toString(), init));

    if (response.status === 404 || response.status === 204) {
      return null;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Durable Object request failed: ${response.status} ${text}`);
    }

    const contentType = response.headers.get('Content-Type');
    if (contentType?.includes('application/json') || response.status === 200) {
      try {
        return (await response.json()) as T;
      } catch {
        return null;
      }
    }

    return null;
  }
}
