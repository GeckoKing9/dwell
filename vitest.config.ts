import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/main.tsx', 'src/background/index.ts', 'src/content/**'],
      reporter: ['text-summary', 'html'],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
        'src/tracker/**': {
          lines: 90,
          branches: 90,
          functions: 90,
          statements: 90,
        },
        'src/store/**': {
          lines: 90,
          branches: 90,
          functions: 90,
          statements: 90,
        },
        'src/shared/settings.ts': {
          lines: 90,
          branches: 90,
          functions: 90,
          statements: 90,
        },
      },
    },
  },
});
