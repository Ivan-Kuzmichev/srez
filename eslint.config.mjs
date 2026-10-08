import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Domain logic stays pure: no database, network, or framework imports.
    files: ['src/domain/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '@/db/*',
            '@/integrations/*',
            '@/server/*',
            '@/app/*',
            '@/jobs/*',
            'next',
            'next/*',
            'react',
          ],
        },
      ],
    },
  },
  {
    // Secrets are decrypted only in the worker, right before an external call (docs/07, section 7).
    files: ['src/**'],
    ignores: ['src/domain/**', 'src/jobs/**', 'src/worker.ts', 'src/server/secret-read.ts', 'src/server/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/server/secret-read', '**/secret-read'],
              message: 'Decrypt secrets in the worker only.',
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'dist/**',
    'design/**',
    'next-env.d.ts',
    'playwright-report/**',
    'coverage/**',
    'test-results/**',
    'drizzle/meta/**',
  ]),
]);
