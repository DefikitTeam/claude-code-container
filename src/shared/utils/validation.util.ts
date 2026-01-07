/**
 * Validation utilities
 * Helper functions for common validation patterns
 */

import { ValidationError } from '../errors/validation.error';

/**
 * Validate that a value is not empty
 */
export function validateRequired(value: any, fieldName: string): void {
  if (value === null || value === undefined || value === '') {
    throw ValidationError.required(fieldName);
  }
}

/**
 * Validate that a string matches a pattern
 */
export function validatePattern(
  value: string,
  pattern: RegExp,
  fieldName: string,
  message?: string,
): void {
  if (!pattern.test(value)) {
    throw new ValidationError(
      message || `${fieldName} does not match required pattern`,
      fieldName,
    );
  }
}

/**
 * Validate email format
 */
export function validateEmail(
  email: string,
  fieldName: string = 'email',
): void {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    throw ValidationError.invalid(fieldName, 'invalid email format');
  }
}

/**
 * Validate URL format
 */
export function validateUrl(url: string, fieldName: string = 'url'): void {
  try {
    new URL(url);
  } catch {
    throw ValidationError.invalid(fieldName, 'invalid URL format');
  }
}

/**
 * Validate string length
 */
export function validateLength(
  value: string,
  min: number,
  max: number,
  fieldName: string,
): void {
  if (value.length < min || value.length > max) {
    throw new ValidationError(
      `${fieldName} must be between ${min} and ${max} characters`,
      fieldName,
      value.length,
      `length:${min}-${max}`,
    );
  }
}

/**
 * Validate number is within range
 */
export function validateRange(
  value: number,
  min: number,
  max: number,
  fieldName: string,
): void {
  if (value < min || value > max) {
    throw new ValidationError(
      `${fieldName} must be between ${min} and ${max}`,
      fieldName,
      value,
      `range:${min}-${max}`,
    );
  }
}

/**
 * Validate that array is not empty
 */
export function validateArrayNotEmpty<T>(array: T[], fieldName: string): void {
  if (!Array.isArray(array) || array.length === 0) {
    throw new ValidationError(
      `${fieldName} must contain at least one item`,
      fieldName,
    );
  }
}

/**
 * Validate that a value is one of allowed values
 */
export function validateEnum<T>(
  value: T,
  allowedValues: T[],
  fieldName: string,
): void {
  if (!allowedValues.includes(value)) {
    throw new ValidationError(
      `${fieldName} must be one of: ${allowedValues.join(', ')}`,
      fieldName,
      value,
      `enum:${allowedValues.join(',')}`,
    );
  }
}

/**
 * Validate GitHub repository format (owner/repo)
 */
export function validateGitHubRepository(repo: string): void {
  validatePattern(
    repo,
    /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/,
    'repository',
    'Repository must be in format: owner/repo',
  );
}

/**
 * Validate GitHub branch name
 */
export function validateGitHubBranchName(branch: string): void {
  validatePattern(
    branch,
    /^[a-zA-Z0-9._\/-]+$/,
    'branch',
    'Invalid branch name format',
  );
}

/**
 * Validate installation ID format
 * Accepts: numeric string (e.g., "123456") or "default" (when githubToken is passed in body)
 */
export function validateInstallationId(installationId: string): void {
  // Allow "default" as a special value (when token is passed in request body)
  if (installationId === 'default') {
    return;
  }
  validatePattern(
    installationId,
    /^\d+$/,
    'installationId',
    'Installation ID must be numeric or "default"',
  );
}

/**
 * Validate user ID format
 */
export function validateUserId(userId: string): void {
  validateRequired(userId, 'userId');
  validateLength(userId, 1, 255, 'userId');
}

/**
 * Validate API key format
 */
export function validateApiKey(apiKey: string): void {
  validateRequired(apiKey, 'apiKey');
  if (apiKey.length < 20) {
    throw new ValidationError(
      'API key must be at least 20 characters',
      'apiKey',
    );
  }
  if (apiKey.includes(' ') || apiKey.includes('\n')) {
    throw new ValidationError('API key contains invalid characters', 'apiKey');
  }
}

/**
 * Validator object for fluent interface
 */
export class Validator {
  private errors: Map<string, string> = new Map();

  require(value: any, fieldName: string): this {
    try {
      validateRequired(value, fieldName);
    } catch (e) {
      if (e instanceof ValidationError) {
        this.errors.set(fieldName, e.message);
      }
    }
    return this;
  }

  email(value: any, fieldName: string = 'email'): this {
    try {
      validateEmail(value, fieldName);
    } catch (e) {
      if (e instanceof ValidationError) {
        this.errors.set(fieldName, e.message);
      }
    }
    return this;
  }

  url(value: any, fieldName: string = 'url'): this {
    try {
      validateUrl(value, fieldName);
    } catch (e) {
      if (e instanceof ValidationError) {
        this.errors.set(fieldName, e.message);
      }
    }
    return this;
  }

  length(value: any, min: number, max: number, fieldName: string): this {
    try {
      validateLength(value, min, max, fieldName);
    } catch (e) {
      if (e instanceof ValidationError) {
        this.errors.set(fieldName, e.message);
      }
    }
    return this;
  }

  enum<T>(value: any, allowedValues: T[], fieldName: string): this {
    try {
      validateEnum(value, allowedValues, fieldName);
    } catch (e) {
      if (e instanceof ValidationError) {
        this.errors.set(fieldName, e.message);
      }
    }
    return this;
  }

  validate(): void {
    if (this.errors.size > 0) {
      const messages = Array.from(this.errors.values()).join('; ');
      throw new ValidationError(messages);
    }
  }

  getErrors(): Map<string, string> {
    return this.errors;
  }

  hasErrors(): boolean {
    return this.errors.size > 0;
  }
}
