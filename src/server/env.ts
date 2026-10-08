import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_PATH: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  APP_URL: z.preprocess(emptyToUndefined, z.url().default('http://localhost:3000')),
  APP_SECRET_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
  TRUSTED_PROXIES: z.preprocess(emptyToUndefined, z.string().optional()),
  TINVEST_PROXY_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** Sign-in attempts per minute per address (docs/07-auth-security.md, section 2). Raised only in e2e. */
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(20),
});

export type Env = z.infer<typeof EnvSchema> & { DATABASE_PATH: string };

let cached: Env | undefined;

/**
 * Development keeps the database outside the project: Turbopack watches the whole project tree and
 * reloads the page on every write to a file inside it. Production (Docker) uses ./data via compose.
 */
function defaultDatabasePath(nodeEnv: string): string {
  return nodeEnv === 'production' ? './data/srez.db' : join(homedir(), '.srez', 'dev.db');
}

export function env(): Env {
  if (!cached) {
    const parsed = EnvSchema.parse(process.env);
    cached = { ...parsed, DATABASE_PATH: parsed.DATABASE_PATH ?? defaultDatabasePath(parsed.NODE_ENV) };
  }
  return cached;
}

// Fixed secret for development and tests only; production refuses to start without AUTH_SECRET.
const DEV_AUTH_SECRET = 'srez-development-secret-do-not-use-in-production';

export function authSecret(): string {
  const { AUTH_SECRET, NODE_ENV } = env();
  if (AUTH_SECRET) return AUTH_SECRET;
  if (NODE_ENV === 'production')
    throw new Error('AUTH_SECRET is not set. Generate one: openssl rand -base64 32');
  return DEV_AUTH_SECRET;
}

export function trustedProxyList(): string[] {
  return (env().TRUSTED_PROXIES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
