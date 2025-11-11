import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TokenServiceImpl } from '../../infrastructure/services/token.service.impl';
import { ValidationError } from '../../shared/errors/validation.error';

describe('TokenServiceImpl', () => {
  let generator: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    generator = vi.fn(async (installationId: string) => `token-${installationId}-${Math.random().toString(36).slice(2, 8)}`);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates and caches installation tokens', async () => {
    const service = new TokenServiceImpl(generator);

    const first = await service.getInstallationToken('inst-1');
    const second = await service.getInstallationToken('inst-1');

    expect(first.token).toBeDefined();
    expect(second.token).toBe(first.token);
    expect(generator).toHaveBeenCalledTimes(1);
  });

  it('validates installation identifiers before generating tokens', async () => {
    const service = new TokenServiceImpl(generator);
    await expect(service.getInstallationToken('')).rejects.toThrow(ValidationError);
  });

  it('invalidates cached tokens explicitly', async () => {
    const service = new TokenServiceImpl(generator);
    await service.getInstallationToken('inst-2');

    expect(generator).toHaveBeenCalledTimes(1);
    await service.invalidateToken('inst-2');
    await service.getInstallationToken('inst-2');

    expect(generator).toHaveBeenCalledTimes(2);
  });

  it('detects tokens nearing expiration via buffer logic', () => {
    const service = new TokenServiceImpl(generator);
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(0);
    const farFuture = 10 * 60 * 1000; // 10 minutes ahead
    expect(service.isTokenValid('inst', farFuture)).toBe(true);

    // Move clock near expiry buffer (4 minutes remaining < 5 minute buffer)
    nowSpy.mockReturnValue(farFuture - 4 * 60 * 1000);
    expect(service.isTokenValid('inst', farFuture)).toBe(false);
  });

  it('refreshes expired tokens and clears cache', async () => {
    const service = new TokenServiceImpl(generator);
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(0);
    const { expiresAt } = await service.getInstallationToken('inst-3');
    expect(service.getCacheStats().totalCached).toBe(1);

    nowSpy.mockReturnValue(expiresAt + 1);
    const refreshed = await service.refreshExpiredTokens();
    expect(refreshed).toBe(1);
    expect(service.getCacheStats().totalCached).toBe(0);
  });
});
