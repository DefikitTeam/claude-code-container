/**
 * ValidationError - Error thrown when validation fails
 * HTTP Status: 400 Bad Request
 */

import { BaseError } from './base.error';

export class ValidationError extends BaseError {
  public readonly field?: string;
  public readonly value?: unknown;
  public readonly constraint?: string;

  constructor(
    message: string,
    field?: string,
    value?: unknown,
    constraint?: string,
    details?: Record<string, unknown>
  ) {
    super(
      message,
      'VALIDATION_ERROR',
      400,
      { field, value, constraint, ...details },
      true // operational error - safe to expose
    );
    this.field = field;
    this.value = value;
    this.constraint = constraint;
  }

  /**
   * Factory method for common validation errors
   */
  static required(field: string): ValidationError {
    return new ValidationError(`${field} is required`, field);
  }

  static invalid(field: string, constraint: string): ValidationError {
    return new ValidationError(
      `${field} is invalid: ${constraint}`,
      field,
      undefined,
      constraint
    );
  }

  static pattern(field: string, expectedPattern: string): ValidationError {
    return new ValidationError(
      `${field} does not match expected pattern: ${expectedPattern}`,
      field,
      undefined,
      `pattern:${expectedPattern}`
    );
  }
}
