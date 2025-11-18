import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Exclude legacy test directory - using clean architecture tests in src/test/ instead
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'test/**', // Legacy tests from old architecture
    ],
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
