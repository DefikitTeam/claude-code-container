import { describe, it, expect } from 'vitest';
import {
  ErrorClassifier,
  ClassifiedErrorCode,
} from '../src/core/errors/error-classifier';

describe('ErrorClassifier', () => {
  const classifier = new ErrorClassifier();

  it('classifies auth errors', () => {
    const err = new Error('API key invalid or authentication failed');
    const c = classifier.classify(err);
    expect(c.code).toBe(ClassifiedErrorCode.AuthError);
  });

  it('classifies CLI missing', () => {
    const err = Object.assign(new Error('Claude binary not found'), {
      stderrTail: 'not found',
    });
    const c = classifier.classify(err);
    expect(c.code).toBe(ClassifiedErrorCode.CliMissing);
  });

  it('classifies cancelled', () => {
    const err = new Error('Operation cancelled');
    const c = classifier.classify(err);
    expect(c.code).toBe(ClassifiedErrorCode.Cancelled);
  });
});
