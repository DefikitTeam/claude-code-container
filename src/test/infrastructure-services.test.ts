/**
 * Infrastructure Services Tests
 * Tests services and adapters directly without type issues
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CryptoServiceImpl } from '../infrastructure/services/crypto.service.impl';
import { DeploymentServiceImpl } from '../infrastructure/services/deployment.service.impl';
import { DeploymentRepositoryImpl } from '../infrastructure/repositories/deployment-repository.impl';
import { ValidationError } from '../shared/errors/validation.error';

describe('Infrastructure Services', () => {
  describe('CryptoServiceImpl', () => {
    let cryptoService: CryptoServiceImpl;

    beforeEach(async () => {
      cryptoService = new CryptoServiceImpl();
      // Initialize with a test key (32 bytes = 256 bits for AES-256)
      const testKey = 'a'.repeat(64); // 64 hex chars = 32 bytes
      await cryptoService.initialize(testKey);
    });

    it('should hash data consistently', async () => {
      const data = 'test-data';
      const hash1 = await cryptoService.hash(data);
      const hash2 = await cryptoService.hash(data);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256
    });

    it('should throw without initialization', async () => {
      const uninitializedService = new CryptoServiceImpl();
      await expect(uninitializedService.encrypt('data')).rejects.toThrow();
    });
  });

  describe('DeploymentServiceImpl', () => {
    let deploymentService: DeploymentServiceImpl;

    beforeEach(() => {
      deploymentService = new DeploymentServiceImpl();
    });

    it('should deploy worker successfully', async () => {
      const result = await deploymentService.deploy({
        workerCode: 'export default { fetch: () => new Response("Hello") }',
        installationId: 'inst-123',
        configHash: 'hash123',
        version: '1.0.0',
      });

      expect(result.success).toBe(true);
      expect(result.url).toBeDefined();
      expect(result.url).toContain('inst-123');
    });

    it('should reject deployment with missing parameters', async () => {
      await expect(
        deploymentService.deploy({
          workerCode: '',
          installationId: 'inst-123',
          configHash: 'hash123',
          version: '1.0.0',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should get deployment status', async () => {
      const deployResult = await deploymentService.deploy({
        workerCode: 'export default { fetch: () => new Response("Hello") }',
        installationId: 'inst-123',
        configHash: 'hash123',
        version: '1.0.0',
      });

      // Get status by deployment URL
      const status = await deploymentService.getStatus(deployResult.url);
      expect(status).toBeDefined();
      expect(['success', 'pending', 'in-progress']).toContain(status.status);
    });
  });

  describe('DeploymentRepositoryImpl', () => {
    let repository: DeploymentRepositoryImpl;

    beforeEach(() => {
      repository = new DeploymentRepositoryImpl();
    });

    it('should save and retrieve deployments', async () => {
      const deploymentData = {
        deploymentId: 'dep-123',
        installationId: 'inst-123',
        status: 'deployed' as const,
        version: '1.0.0',
        configHash: 'hash123',
        workerCode: 'code',
        deployedAt: Date.now(),
        logs: [],
      };

      // Create entity from data
      const entity = {
        ...deploymentData,
        getProps: () => deploymentData,
        validate: () => true,
        previousVersion: null,
        rollbackDeploymentId: null,
        url: 'https://worker.example.com',
        isValid: () => true,
        isPending: () => false,
        isCompleted: () => true,
        isFailed: () => false,
      } as any;

      await repository.save(entity);
      const retrieved = await repository.findById('dep-123');

      expect(retrieved).toBeDefined();
    });

    it('should find latest deployment by installation', async () => {
      const now = Date.now();

      const dep1 = {
        deploymentId: 'dep-1',
        installationId: 'inst-123',
        status: 'deployed' as const,
        version: '1.0.0',
        configHash: 'hash1',
        workerCode: 'code1',
        deployedAt: now,
        logs: [],
        getProps: () => ({}),
        validate: () => true,
        previousVersion: null,
        rollbackDeploymentId: null,
        url: 'https://worker1.example.com',
        isValid: () => true,
        isPending: () => false,
        isCompleted: () => true,
        isFailed: () => false,
      } as any;

      const dep2 = {
        deploymentId: 'dep-2',
        installationId: 'inst-123',
        status: 'deployed' as const,
        version: '1.0.1',
        configHash: 'hash2',
        workerCode: 'code2',
        deployedAt: now + 1000,
        logs: [],
        getProps: () => ({}),
        validate: () => true,
        previousVersion: null,
        rollbackDeploymentId: null,
        url: 'https://worker2.example.com',
        isValid: () => true,
        isPending: () => false,
        isCompleted: () => true,
        isFailed: () => false,
      } as any;

      await repository.save(dep1);
      await repository.save(dep2);

      const latest = await repository.findLatestByInstallation('inst-123');
      expect(latest?.deploymentId).toBe('dep-2');
    });

    it('should list deployments by installation', async () => {
      const now = Date.now();
      const deps = [];

      for (let i = 0; i < 3; i++) {
        const dep = {
          deploymentId: `dep-${i}`,
          installationId: 'inst-789',
          status: 'deployed' as const,
          version: `1.0.${i}`,
          configHash: `hash${i}`,
          workerCode: `code${i}`,
          deployedAt: now + i * 1000,
          logs: [],
          getProps: () => ({}),
          validate: () => true,
          previousVersion: null,
          rollbackDeploymentId: null,
          url: `https://worker${i}.example.com`,
          isValid: () => true,
          isPending: () => false,
          isCompleted: () => true,
          isFailed: () => false,
        } as any;
        deps.push(dep);
        await repository.save(dep);
      }

      const deployments = await repository.listByInstallation('inst-789', 10);
      expect(deployments).toHaveLength(3);
      expect(deployments[0].deploymentId).toBe('dep-2');
    });

    it('should return empty array for non-existent installation', async () => {
      const deployments = await repository.listByInstallation(
        'non-existent',
        10,
      );
      expect(deployments).toHaveLength(0);
    });
  });

  describe('Service Integration', () => {
    it('should hash data using crypto service', async () => {
      const cryptoService = new CryptoServiceImpl();
      const data = 'test-data';

      const hash1 = await cryptoService.hash(data);
      const hash2 = await cryptoService.hash(data);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('should deploy and retrieve status', async () => {
      const deploymentService = new DeploymentServiceImpl();
      const code = 'export default { fetch: () => new Response("OK") }';

      const deployment = await deploymentService.deploy({
        workerCode: code,
        installationId: 'inst-123',
        configHash: 'hash123',
        version: '1.0.0',
      });

      expect(deployment.success).toBe(true);

      const status = await deploymentService.getStatus(deployment.url);
      expect(status).toBeDefined();
    });

    it('should save and retrieve deployments from repository', async () => {
      const repository = new DeploymentRepositoryImpl();
      const deploymentData = {
        deploymentId: 'dep-456',
        installationId: 'inst-456',
        status: 'success' as const,
        version: '1.0.0',
        configHash: 'hash456',
        workerCode: 'code',
        deployedAt: Date.now(),
        logs: [],
        getProps: () => ({}),
        validate: () => true,
        previousVersion: null,
        rollbackDeploymentId: null,
        url: 'https://example.com',
        isValid: () => true,
        isPending: () => false,
        isCompleted: () => true,
        isFailed: () => false,
      } as any;

      await repository.save(deploymentData);
      const retrieved = await repository.findById('dep-456');

      expect(retrieved).toBeDefined();
    });
  });
});
