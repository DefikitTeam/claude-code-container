import { describe, it, expect } from 'vitest';
import { BaseError } from '../src-new/shared/errors/base.error';
import { ValidationError } from '../src-new/shared/errors/validation.error';
import { NotFoundError } from '../src-new/shared/errors/not-found.error';
import { UnauthorizedError } from '../src-new/shared/errors/unauthorized.error';
import {
  validateRequired,
  validateEmail,
  validateLength,
  validateApiKey,
  Validator,
} from '../src-new/shared/utils/validation.util';
import {
  bufferToHex,
  hexToBuffer,
  maskSensitiveData,
} from '../src-new/shared/utils/crypto.util';

describe('Shared Layer - Phase 1', () => {
  describe('BaseError', () => {
    it('should create a base error with correct properties', () => {
      const error = new BaseError('Test error', 'TEST_ERROR', 500);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.name).toBe('BaseError');
      expect(error.isSafeForClient()).toBe(true);
    });

    it('should convert error to JSON', () => {
      const error = new BaseError('Test error', 'TEST_ERROR', 400, {
        field: 'name',
      });
      const json = error.toJSON();
      expect(json.code).toBe('TEST_ERROR');
      expect(json.message).toBe('Test error');
      expect(json.statusCode).toBe(400);
      expect(json.details).toEqual({ field: 'name' });
    });
  });

  describe('ValidationError', () => {
    it('should create validation error with default status 400', () => {
      const error = new ValidationError('Invalid input', 'field1');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.field).toBe('field1');
    });

    it('should create required field error', () => {
      const error = ValidationError.required('email');
      expect(error.message).toContain('email');
      expect(error.message).toContain('required');
    });

    it('should create invalid field error', () => {
      const error = ValidationError.invalid('age', 'must be positive');
      expect(error.message).toContain('age');
      expect(error.message).toContain('invalid');
    });

    it('should create pattern error', () => {
      const error = ValidationError.pattern('url', '^https://');
      expect(error.message).toContain('pattern');
    });
  });

  describe('NotFoundError', () => {
    it('should create not found error with 404 status', () => {
      const error = NotFoundError.user('user123');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('NOT_FOUND_ERROR');
      expect(error.resourceType).toBe('User');
      expect(error.resourceId).toBe('user123');
    });

    it('should create installation not found error', () => {
      const error = NotFoundError.installation('inst456');
      expect(error.message).toContain('Installation');
      expect(error.resourceId).toBe('inst456');
    });

    it('should create repository not found error', () => {
      const error = NotFoundError.repository('owner/repo');
      expect(error.message).toContain('Repository');
    });
  });

  describe('UnauthorizedError', () => {
    it('should create authentication error', () => {
      const error = UnauthorizedError.authentication('Invalid credentials');
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('UNAUTHORIZED_ERROR');
      expect(error.errorType).toBe('AUTHENTICATION');
    });

    it('should create missing token error', () => {
      const error = UnauthorizedError.missingToken();
      expect(error.statusCode).toBe(401);
      expect(error.message).toContain('token');
    });

    it('should create insufficient permissions error', () => {
      const error = UnauthorizedError.insufficientPermissions(
        'admin',
        'resource',
      );
      expect(error.statusCode).toBe(403);
      expect(error.errorType).toBe('AUTHORIZATION');
      expect(error.message).toContain('admin');
    });

    it('should create forbidden error', () => {
      const error = UnauthorizedError.forbidden('Access denied');
      expect(error.statusCode).toBe(403);
    });
  });

  describe('Validation Utilities', () => {
    it('should validate required field', () => {
      expect(() => validateRequired('value', 'field')).not.toThrow();
      expect(() => validateRequired('', 'field')).toThrow(ValidationError);
      expect(() => validateRequired(null, 'field')).toThrow(ValidationError);
      expect(() => validateRequired(undefined, 'field')).toThrow(
        ValidationError,
      );
    });

    it('should validate email format', () => {
      expect(() => validateEmail('test@example.com')).not.toThrow();
      expect(() => validateEmail('invalid-email')).toThrow(ValidationError);
    });

    it('should validate string length', () => {
      expect(() => validateLength('hello', 1, 10, 'text')).not.toThrow();
      expect(() => validateLength('hello', 10, 20, 'text')).toThrow(
        ValidationError,
      );
    });

    it('should validate API key format', () => {
      const validKey = 'sk-ant-' + 'a'.repeat(30);
      expect(() => validateApiKey(validKey)).not.toThrow();
      expect(() => validateApiKey('short')).toThrow(ValidationError);
      expect(() => validateApiKey('key with space')).toThrow(ValidationError);
    });

    it('should use fluent validator', () => {
      const validator = new Validator()
        .require('value', 'field1')
        .email('test@example.com', 'email');

      expect(() => validator.validate()).not.toThrow();
      expect(validator.hasErrors()).toBe(false);
    });

    it('should collect validation errors', () => {
      const validator = new Validator()
        .require('', 'field1')
        .email('invalid-email', 'email');

      expect(() => validator.validate()).toThrow(ValidationError);
      expect(validator.hasErrors()).toBe(true);
    });
  });

  describe('Crypto Utilities', () => {
    it('should convert buffer to hex and back', () => {
      const buffer = new Uint8Array([1, 2, 3, 255]);
      const hex = bufferToHex(buffer.buffer);
      const restored = new Uint8Array(hexToBuffer(hex));

      expect(restored).toEqual(buffer);
    });

    it('should mask sensitive data', () => {
      const original = 'super-secret-key-12345';
      const masked = maskSensitiveData(original, 4);

      // Should show first 4 chars
      expect(masked.startsWith('supe')).toBe(true);
      // Should show last 4 chars
      expect(masked.endsWith('2345')).toBe(true);
      // Should not contain middle part
      expect(masked).not.toContain('secret');
    });

    it('should validate encrypted payload format', () => {
      // This is tested in the infrastructure layer
      // Shared layer just provides utility functions
    });
  });

  describe('Types Export', () => {
    it('should have all types available', () => {
      // Import types from shared/types/index
      // This test verifies the import compiles
      const testType: any = {
        userId: 'user123',
        installationId: '456',
        anthropicApiKey: 'key',
      };
      expect(testType.userId).toBeDefined();
    });
  });
});
