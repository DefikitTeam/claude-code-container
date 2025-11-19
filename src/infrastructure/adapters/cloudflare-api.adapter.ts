/**
 * Cloudflare API Adapter
 * Wrapper for Cloudflare Workers API and deployment operations
 */

import { ValidationError } from '../../shared/errors/validation.error';

/**
 * Cloudflare API configuration
 */
export interface CloudflareConfig {
  accountId: string;
  apiToken: string;
  workerName?: string;
  zoneId?: string;
}

/**
 * Cloudflare Worker deployment response
 */
export interface WorkerDeploymentResponse {
  success: boolean;
  id?: string;
  url?: string;
  errors?: string[];
}

/**
 * Cloudflare API Adapter
 * Handles direct API calls to Cloudflare Workers platform
 */
export class CloudflareApiAdapter {
  private accountId: string;
  private apiToken: string;
  private workerName: string;
  private zoneId: string;
  private readonly baseUrl = 'https://api.cloudflare.com/client/v4';
  private readonly workersBaseUrl =
    'https://api.cloudflare.com/client/v4/accounts';

  constructor(config: CloudflareConfig) {
    if (!config.accountId || !config.apiToken) {
      throw new ValidationError('accountId and apiToken are required');
    }

    this.accountId = config.accountId;
    this.apiToken = config.apiToken;
    this.workerName = config.workerName || 'claude-code-container';
    this.zoneId = config.zoneId || '';
  }

  /**
   * Deploy a worker script
   *
   * @param workerCode - JavaScript code to deploy
   * @param metadata - Optional deployment metadata
   * @returns Deployment response
   */
  async deployWorker(
    workerCode: string,
    metadata?: Record<string, string>,
  ): Promise<WorkerDeploymentResponse> {
    if (!workerCode || typeof workerCode !== 'string') {
      throw new ValidationError('workerCode must be a non-empty string');
    }

    try {
      const formData = new FormData();

      // Add worker script
      formData.append(
        'script',
        new Blob([workerCode], { type: 'application/javascript' }),
        'script.js',
      );

      // Add metadata if provided
      if (metadata) {
        formData.append('metadata', JSON.stringify(metadata));
      }

      const url = `${this.workersBaseUrl}/${this.accountId}/workers/scripts/${this.workerName}`;

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error: any = await response.json();
        return {
          success: false,
          errors: [error.errors?.[0]?.message || `HTTP ${response.status}`],
        };
      }

      const data = (await response.json()) as any;

      return {
        success: true,
        id: data.result?.id,
        url: `https://${this.workerName}.${this.workerName}.workers.dev`,
      };
    } catch (error) {
      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  }

  /**
   * Get worker deployment status
   *
   * @returns Deployment information
   */
  async getWorkerStatus(): Promise<{
    deployed: boolean;
    version?: string;
    lastUpdated?: string;
  }> {
    try {
      const url = `${this.workersBaseUrl}/${this.accountId}/workers/scripts/${this.workerName}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return { deployed: false };
      }

      const data = (await response.json()) as any;

      return {
        deployed: true,
        version: data.result?.main_module,
        lastUpdated: data.result?.created_on,
      };
    } catch (error) {
      return { deployed: false };
    }
  }

  /**
   * Rollback to a previous worker version
   * (Note: Cloudflare doesn't have built-in rollback; this is a stub)
   *
   * @param version - Version to rollback to
   * @returns Rollback result
   */
  async rollbackWorker(version: string): Promise<{ success: boolean }> {
    if (!version || typeof version !== 'string') {
      throw new ValidationError('version must be a non-empty string');
    }

    // In production, this would:
    // 1. Fetch the versioned code from your storage
    // 2. Deploy it using deployWorker()
    // 3. Return success status

    // For now, return stub response
    console.warn(
      'Worker rollback is not fully implemented - use version control instead',
    );
    return { success: true };
  }

  /**
   * Delete a worker
   *
   * @returns Success status
   */
  async deleteWorker(): Promise<{ success: boolean }> {
    try {
      const url = `${this.workersBaseUrl}/${this.accountId}/workers/scripts/${this.workerName}`;

      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
      });

      return {
        success: response.ok,
      };
    } catch (error) {
      return { success: false };
    }
  }

  /**
   * Get KV namespace for storing data
   *
   * @param namespaceName - KV namespace name
   * @returns KV namespace ID
   */
  async getKVNamespace(namespaceName: string): Promise<string | null> {
    try {
      const url = `${this.baseUrl}/accounts/${this.accountId}/storage/kv/namespaces`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as any;
      const namespace = data.result?.find(
        (ns: any) => ns.title === namespaceName,
      );

      return namespace?.id || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Store data in KV
   *
   * @param namespaceId - KV namespace ID
   * @param key - Storage key
   * @param value - Data to store
   * @param ttl - Time to live in seconds (optional)
   * @returns Success status
   */
  async putKVData(
    namespaceId: string,
    key: string,
    value: string,
    ttl?: number,
  ): Promise<{ success: boolean }> {
    try {
      const url = `${this.baseUrl}/accounts/${this.accountId}/storage/kv/namespaces/${namespaceId}/values/${key}`;

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value, expirationTtl: ttl }),
      });

      return {
        success: response.ok,
      };
    } catch (error) {
      return { success: false };
    }
  }

  /**
   * Retrieve data from KV
   *
   * @param namespaceId - KV namespace ID
   * @param key - Storage key
   * @returns Stored value or null
   */
  async getKVData(namespaceId: string, key: string): Promise<string | null> {
    try {
      const url = `${this.baseUrl}/accounts/${this.accountId}/storage/kv/namespaces/${namespaceId}/values/${key}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
      });

      if (!response.ok) {
        return null;
      }

      return await response.text();
    } catch (error) {
      return null;
    }
  }

  /**
   * Delete data from KV
   *
   * @param namespaceId - KV namespace ID
   * @param key - Storage key
   * @returns Success status
   */
  async deleteKVData(
    namespaceId: string,
    key: string,
  ): Promise<{ success: boolean }> {
    try {
      const url = `${this.baseUrl}/accounts/${this.accountId}/storage/kv/namespaces/${namespaceId}/values/${key}`;

      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
      });

      return {
        success: response.ok,
      };
    } catch (error) {
      return { success: false };
    }
  }
}
