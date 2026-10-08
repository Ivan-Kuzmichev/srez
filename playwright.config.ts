import { defineConfig, devices } from '@playwright/test';
import { E2E_LOCKOUT_USER, E2E_TOTP_USER, E2E_USER } from './tests/e2e/users';

const port = Number(process.env.E2E_PORT ?? 3100);
const db = './data/e2e.db';

const createUser = (u: { username: string; password: string }) =>
  `printf '%s\\n%s\\n' '${u.password}' '${u.password}' | pnpm -s cli user:create --username ${u.username}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  globalSetup: './tests/e2e/global-setup.ts',
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
    command: [
      `rm -f ${db} ${db}-wal ${db}-shm`,
      'pnpm -s db:migrate',
      createUser(E2E_USER),
      createUser(E2E_LOCKOUT_USER),
      createUser(E2E_TOTP_USER),
      'pnpm next build',
      `pnpm next start -p ${port}`,
    ].join(' && '),
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    env: {
      DATABASE_PATH: db,
      APP_URL: `http://localhost:${port}`,
      AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e-secret',
    },
    timeout: 300_000,
  },
});
