import { defineConfig, devices } from '@playwright/test';
import {
  E2E_EMPTY_USER,
  E2E_LEDGER_USER,
  E2E_LOCKOUT_USER,
  E2E_ONBOARDING_USER,
  E2E_PASSKEY_USER,
  E2E_PORTFOLIO_USER,
  E2E_SESSIONS_USER,
  E2E_TOTP_USER,
  E2E_USER,
} from './tests/e2e/users';

const port = Number(process.env.E2E_PORT ?? 3100);
const db = './data/e2e.db';
const MOCK_PORT = 3199;

const createUser = (u: { username: string; password: string }) =>
  `printf '%s\\n%s\\n' '${u.password}' '${u.password}' | pnpm -s cli user:create --username ${u.username}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: { baseURL: `http://localhost:${port}`, storageState: 'test-results/.auth/owner.json' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'phone',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: false },
    },
  ],
  webServer: {
    // A production build on a fresh database: dev mode compiles routes on first hit and reloads pages mid-test.
    // The worker runs alongside to recalculate positions, as in production.
    command: [
      `rm -f ${db} ${db}-wal ${db}-shm`,
      'pnpm -s db:migrate',
      createUser(E2E_USER),
      createUser(E2E_LOCKOUT_USER),
      createUser(E2E_TOTP_USER),
      createUser(E2E_PASSKEY_USER),
      createUser(E2E_SESSIONS_USER),
      createUser(E2E_LEDGER_USER),
      createUser(E2E_EMPTY_USER),
      createUser(E2E_PORTFOLIO_USER),
      createUser(E2E_ONBOARDING_USER),
      'pnpm exec tsx tests/e2e/seed.ts',
      'pnpm next build',
      // «e2e» marks the worker so global teardown can stop it; Playwright only stops the server.
      // The T-Invest mock answers the wizard and the worker; it is stopped with the worker.
      `(TINVEST_MOCK_DELAY_MS=300 pnpm exec tsx tests/mock/tinvest.ts ${MOCK_PORT} &)`,
      `(LOG_CONSOLE=0 pnpm exec tsx src/worker.ts e2e &) && pnpm next start -p ${port}`,
    ].join(' && '),
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    env: {
      DATABASE_PATH: db,
      APP_URL: `http://localhost:${port}`,
      AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e-secret',
      // 32 bytes in base64: production refuses to store a broker token without a key.
      APP_SECRET_KEY: Buffer.alloc(32, 'srez-e2e-key').toString('base64'),
      // Every scenario signs in from the same address.
      AUTH_RATE_LIMIT: '1000',
      TINVEST_API_URL: `http://127.0.0.1:${MOCK_PORT}/rest`,
    },
    timeout: 300_000,
  },
});
