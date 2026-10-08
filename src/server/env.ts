import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_PATH: z.string().min(1).default('./data/srez.db'),
  APP_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  APP_SECRET_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  AUTH_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  TRUSTED_PROXIES: z.preprocess(emptyToUndefined, z.string().optional()),
  TINVEST_PROXY_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  cached ??= EnvSchema.parse(process.env);
  return cached;
}
