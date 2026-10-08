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
  },
});
