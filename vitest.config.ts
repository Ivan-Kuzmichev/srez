import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    environment: 'node',
    // Never touch a real database file; quiet console logs.
    env: { DATABASE_PATH: ':memory:', LOG_CONSOLE: '0' },
    setupFiles: ['tests/setup.ts'],
    // `pnpm test:coverage`: the domain must stay at 90 % or more (docs/02-architecture.md, section 8).
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.ts'],
      exclude: ['src/domain/**/*.test.ts', 'src/domain/ledger-types.ts'],
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
