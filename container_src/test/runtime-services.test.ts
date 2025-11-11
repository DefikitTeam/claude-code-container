import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadRuntimeServices() {
  const [{ getRuntimeServices }, { getContainer }] = await Promise.all([
    import('../src/config/runtime-services.js'),
    import('../src/config/container.config.js'),
  ]);
  return { services: getRuntimeServices(), container: getContainer() };
}

describe('runtime services integration', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    const { resetContainer } = await import('../src/config/container.config.js');
    resetContainer();
  });

  it('returns container-backed services by default', async () => {
    const { services, container } = await loadRuntimeServices();

    expect(services.container).toBe(container);
    expect(services.sessionStore).toBe(container.sessionStore);
    expect(services.workspaceService).toBe(container.workspaceService);
    expect(services.gitService).toBe(container.gitService);
    expect(services.githubAutomationService).toBe(
      container.githubAutomationService,
    );
    expect(services.claudeClient).toBe(container.claudeClient);
    expect(services.promptProcessor).toBe(container.promptProcessor);
  });

  it('ignores legacy clean-architecture flags', async () => {
    vi.stubEnv('USE_CLEAN_ARCH', '0');
    vi.stubEnv('ROLLBACK_CLEAN_ARCH', '1');

    const { services, container } = await loadRuntimeServices();

    expect(services.container).toBe(container);
    expect(services.sessionStore).toBe(container.sessionStore);
    expect(services.workspaceService).toBe(container.workspaceService);
    expect(services.gitService).toBe(container.gitService);
    expect(services.githubAutomationService).toBe(
      container.githubAutomationService,
    );
    expect(services.claudeClient).toBe(container.claudeClient);
    expect(services.promptProcessor).toBe(container.promptProcessor);
  });
});
