import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      reporter: ['text', 'html'],
      exclude: ['node_modules/**', 'test/**', '*.config.*'],
    },
  },
  resolve: {
    alias: {
      '@': '/src',
      'cloudflare:workers': '/test/stubs/cloudflare-workers.ts',
    },
  },
});
