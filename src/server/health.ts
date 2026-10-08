import { and, count, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { jobs, logs } from '@/db/schema';
import { TINVEST_API_URL } from '@/integrations/tinvest/client';
import { nodeTransport, type Transport } from '@/integrations/tinvest/transport';
import pkg from '../../package.json';
import { env } from './env';

export const APP_VERSION = process.env.SREZ_VERSION || pkg.version;

export interface ExternalCheck {
  name: 'tinvest' | 'moex' | 'cbr' | 'coingecko';
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}

export interface Health {
  ok: boolean;
  version: string;
  database: { ok: boolean; latencyMs: number };
  queue: { queued: number; running: number; failedLastDay: number };
  errorsLastDay: number;
  external: ExternalCheck[];
  checkedAt: string;
}

const TIMEOUT_MS = 3000;

/** An answer of any status means the service is up and reachable; only no answer is a failure. */
async function ping(name: ExternalCheck['name'], run: () => Promise<number>): Promise<ExternalCheck> {
  const started = Date.now();
  try {
    await run();
    return { name, ok: true, latencyMs: Date.now() - started, error: null };
  } catch (err) {
    return { name, ok: false, latencyMs: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface Probes {
  fetchFn?: typeof fetch;
  transport?: Transport;
}

/**
 * External APIs with their delay (FR-DEV-6), asked live without credentials: T-Invest answers an
 * anonymous call with 401, which proves the gateway, TLS and the network are fine.
 */
export async function checkExternal(probes: Probes = {}): Promise<ExternalCheck[]> {
  const fetchFn = probes.fetchFn ?? fetch;
  const transport = probes.transport ?? nodeTransport(env().TINVEST_PROXY_URL);
  const get = (url: string) => async () =>
    (await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })).status;
  const base = env().TINVEST_API_URL ?? TINVEST_API_URL;
  return Promise.all([
    ping(
      'tinvest',
      async () =>
        (
          await transport(
            `${base}/tinkoff.public.invest.api.contract.v1.UsersService/GetAccounts`,
            '{}',
            { 'content-type': 'application/json' },
            TIMEOUT_MS,
          )
        ).status,
    ),
    ping('moex', get('https://iss.moex.com/iss/engines.json?iss.meta=off')),
    ping('cbr', get('https://www.cbr.ru/scripts/XML_daily.asp')),
    ping('coingecko', get('https://api.coingecko.com/api/v3/ping')),
  ]);
}

let cached: { at: number; value: ExternalCheck[] } | null = null;
let defaultProbes: Probes = {};

/** Tests: no network for the external checks. */
export function configureHealthProbes(probes: Probes): void {
  defaultProbes = probes;
  cached = null;
}

export function clearHealthCache(): void {
  cached = null;
}

/** «Состояние сервиса» and GET /api/v1/health (FR-DEV-6). External checks are cached for a minute. */
export async function serviceHealth(
  db: Db,
  probes: Probes = defaultProbes,
  now = new Date(),
): Promise<Health> {
  const started = Date.now();
  let dbOk = true;
  try {
    db.get(sql`select 1`);
  } catch {
    dbOk = false;
  }
  const dbMs = Date.now() - started;
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const n = (status: 'queued' | 'running') =>
    db.select({ n: count() }).from(jobs).where(eq(jobs.status, status)).get()?.n ?? 0;
  const failed =
    db
      .select({ n: count() })
      .from(jobs)
      .where(and(eq(jobs.status, 'failed'), gte(jobs.finishedAt, dayAgo)))
      .get()?.n ?? 0;
  const errors =
    db
      .select({ n: count() })
      .from(logs)
      .where(and(eq(logs.level, 'error'), gte(logs.ts, dayAgo)))
      .get()?.n ?? 0;
  if (!cached || now.getTime() - cached.at > 60_000)
    cached = { at: now.getTime(), value: await checkExternal(probes) };
  return {
    ok: dbOk,
    version: APP_VERSION,
    database: { ok: dbOk, latencyMs: dbMs },
    queue: { queued: n('queued'), running: n('running'), failedLastDay: failed },
    errorsLastDay: errors,
    external: cached.value,
    checkedAt: now.toISOString(),
  };
}
