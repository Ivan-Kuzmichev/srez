import { Writable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { saveBrokerAccounts } from '@/db/mutations/broker-accounts';
import { createTinvestSource } from '@/db/mutations/sources';
import { finAccounts, sources, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { TinvestClient } from '@/integrations/tinvest/client';
import { enqueueSync, syncTinvest } from '@/jobs/tinvest-sync';
import { runOnce, type JobDefinition } from '@/jobs/runner';
import { syncSource } from '@/jobs/tinvest-sync';
import { MOCK_TOKEN, startTinvestMock, type TinvestMock } from '../../../tests/mock/tinvest';
import { issueToken, revokeToken } from '../api-tokens';
import { configureHealthProbes } from '../health';
import { createLogger } from '../logger';
import { dispatch } from './dispatch';
import { endpoints } from './endpoints';

const silent = new Writable({ write: (_c, _e, cb) => cb() });
const now = new Date('2026-10-08T12:00:00Z');
const BROKER_TOKEN = MOCK_TOKEN;
const PASSWORD = 'owner password 123';
let mock: TinvestMock;
beforeAll(async () => {
  mock = await startTinvestMock();
  process.env.TINVEST_API_URL = mock.url;
  configureHealthProbes({
    fetchFn: async () => new Response('', { status: 200 }),
    transport: async () => ({ status: 401, headers: {}, body: '{}' }),
  });
});
afterAll(() => mock.close());
beforeEach(() => mock.clearFailures());

async function setup(
  scopes: ('read:data' | 'read:logs' | 'run:sync')[] = ['read:data', 'read:logs', 'run:sync'],
  localOnly = true,
) {
  const db = createTestDb();
  db.insert(user)
    .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
    .run();
  const sourceId = createTinvestSource(db, 'u1', BROKER_TOKEN);
  const client = new TinvestClient(BROKER_TOKEN, { baseUrl: mock.url, sleep: async () => {} });
  saveBrokerAccounts(db, 'u1', sourceId, await client.getAccounts({ includeClosed: true }), () => true);
  await syncSource(db, sourceId, { client, trigger: 'manual', now });
  const { token } = issueToken(db, 'u1', { name: 'Claude, диагностика', ttl: '30d', scopes, localOnly }, now);
  const call = async (
    method: 'GET' | 'POST',
    path: string,
    opts: { ip?: string; auth?: string | null; body?: unknown } = {},
  ) => {
    const url = `http://localhost/api/v1${path}`;
    const headers = new Headers({ 'x-srez-client-ip': opts.ip ?? '192.168.1.5' });
    if (opts.auth !== null) headers.set('authorization', opts.auth ?? `Bearer ${token}`);
    if (opts.body) headers.set('content-type', 'application/json');
    const res = await dispatch(
      db,
      new Request(url, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined }),
      new URL(url).pathname.split('/').slice(3),
      now,
    );
    const text = await res.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the test reads arbitrary JSON
    return { status: res.status, text, json: JSON.parse(text) as Record<string, any> };
  };
  return { db, sourceId, token, call };
}

describe('/api/v1 access (06, sections 2, 3, 6; 07, section 10)', () => {
  it('refuses calls without a token, with a revoked one, and outside the token rights', async () => {
    const s = await setup(['read:data']);
    expect((await s.call('GET', '/accounts', { auth: null })).json).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Missing or malformed token' },
    });
    expect((await s.call('GET', '/logs')).status).toBe(403);
    expect((await s.call('POST', '/sync/run', { body: { sourceId: s.sourceId } })).status).toBe(403);
    revokeToken(s.db, 'u1', now);
    expect((await s.call('GET', '/accounts')).status).toBe(401);
  });

  it('keeps a local-only token on the local network; a forged header reaches it as an outside address', async () => {
    const s = await setup();
    expect((await s.call('GET', '/accounts', { ip: '203.0.113.7' })).json.error.code).toBe('NETWORK');
    expect((await s.call('GET', '/accounts', { ip: '10.0.0.4' })).status).toBe(200);
  });

  it('limits a token to 60 calls a minute', async () => {
    const s = await setup();
    for (let i = 0; i < 60; i++) expect((await s.call('GET', '/accounts')).status).toBe(200);
    const over = await s.call('GET', '/accounts');
    expect([over.status, over.json.error.code]).toEqual([429, 'RATE_LIMITED']);
  });

  it('answers unknown paths, wrong methods and bad input with JSON errors', async () => {
    const s = await setup();
    expect((await s.call('GET', '/nothing')).status).toBe(404);
    expect((await s.call('POST', '/accounts')).status).toBe(405);
    expect((await s.call('GET', '/operations?limit=900')).json.error.code).toBe('INVALID_QUERY');
    expect((await s.call('POST', '/sync/run', { body: {} })).json.error.code).toBe('INVALID_BODY');
    expect((await s.call('GET', '/portfolios/none')).status).toBe(404);
  });
});

describe('/api/v1 data', () => {
  it('serves accounts, positions, the journal with a cursor, an instrument, payouts and discrepancies', async () => {
    const s = await setup();
    const accounts = (await s.call('GET', '/accounts')).json.accounts as { id: string; name: string }[];
    expect(accounts.map((a) => a.name).sort()).toEqual(['Брокерский счёт', 'ИИС', 'ИИС']);
    const a1 = s.db
      .select({ id: finAccounts.id })
      .from(finAccounts)
      .where(eq(finAccounts.externalId, '2000000001'))
      .get()!.id;

    const positions = (await s.call('GET', `/positions?accountId=${a1}`)).json.positions as {
      ticker: string;
      quantity: string;
    }[];
    expect(positions.find((p) => p.ticker === 'SBER')?.quantity).toBe('80');

    const first = (await s.call('GET', `/operations?accountId=${a1}&limit=5`)).json;
    expect(first.operations).toHaveLength(5);
    const second = (await s.call('GET', `/operations?accountId=${a1}&limit=5&cursor=${first.nextCursor}`))
      .json;
    expect(second.operations[0].id).not.toBe(first.operations[4].id);
    expect(typeof first.operations[0].amount).toBe('string');

    const sber = positions.find((p) => p.ticker === 'SBER') as unknown as { instrumentId: string };
    expect((await s.call('GET', `/instruments/${sber.instrumentId}`)).json.instrument.ticker).toBe('SBER');
    expect((await s.call('GET', '/payouts?year=2024')).json.received.length).toBeGreaterThan(0);
    expect((await s.call('GET', '/reconciliation')).json.discrepancies).toHaveLength(2);
    expect((await s.call('GET', '/portfolios')).json.all.valueRub).toMatch(/^\d+(\.\d+)?$/);
  });

  it('shows health, sync status and runs, jobs, and a report; queues sync and recalculation', async () => {
    const s = await setup();
    const health = (await s.call('GET', '/health')).json;
    expect(health).toMatchObject({ ok: true, database: { ok: true } });
    expect(health.external.map((e: { name: string; ok: boolean }) => [e.name, e.ok])).toEqual([
      ['tinvest', true],
      ['moex', true],
      ['cbr', true],
      ['coingecko', true],
    ]);
    expect((await s.call('GET', '/sync/status')).json.sources[0].lastRun.status).toBe('ok');
    expect((await s.call('GET', `/sync/runs?sourceId=${s.sourceId}`)).json.runs).toHaveLength(1);
    const run = await s.call('POST', '/sync/run', { body: { sourceId: s.sourceId } });
    expect(run.json.jobId).toMatch(/^job_\d+$/);
    expect((await s.call('POST', '/sync/run', { body: { sourceId: s.sourceId } })).json.jobId).toBe(
      run.json.jobId,
    );
    expect(
      (await s.call('GET', '/jobs?state=queued')).json.jobs.map((j: { jobId: string }) => j.jobId),
    ).toContain(run.json.jobId);
    const a1 = s.db
      .select({ id: finAccounts.id })
      .from(finAccounts)
      .where(eq(finAccounts.externalId, '2000000001'))
      .get()!.id;
    expect((await s.call('POST', '/positions/recalc', { body: { accountId: a1 } })).json.jobId).toMatch(
      /^job_\d+$/,
    );
    const report = (await s.call('GET', '/diagnostics/report')).json;
    expect(report).toMatchObject({
      version: expect.any(String),
      sources: [expect.objectContaining({ kind: 'tinvest' })],
    });
  });

  it('never returns a secret, from any endpoint (06, section 5)', async () => {
    const s = await setup();
    const a1 = s.db
      .select({ id: finAccounts.id })
      .from(finAccounts)
      .where(eq(finAccounts.externalId, '2000000001'))
      .get()!.id;
    const secrets = [BROKER_TOKEN, s.token, PASSWORD, 'secret_encrypted', 'tokenHash', 'token_hash'];
    for (const e of endpoints.filter((x) => x.method === 'GET')) {
      const path = e.path.replace('{id}', 'x');
      const res = await s.call('GET', `${path}${path === '/positions' ? `?accountId=${a1}` : ''}`);
      for (const secret of secrets) expect(res.text, `${e.path} leaks ${secret}`).not.toContain(secret);
    }
  });

  it('describes every method in OpenAPI without a token', async () => {
    const s = await setup();
    const doc = (await s.call('GET', '/openapi.json', { auth: null })).json;
    expect(doc.openapi).toBe('3.1.0');
    for (const e of endpoints) expect(doc.paths[e.path][e.method.toLowerCase()]['x-scope']).toBe(e.scope);
    expect(doc.paths['/logs'].get.parameters.map((p: { name: string }) => p.name)).toContain('jobId');
  });
});

describe('phase 5 acceptance', () => {
  it('a read:logs token finds a failed sync with its job id, and by that id every related record', async () => {
    const s = await setup(['read:logs']);
    const log = createLogger({ level: 'info', getDb: () => s.db, console: silent });
    // The broker refuses the token: the sync job fails for good.
    s.db.update(sources).set({ secretEncrypted: null }).where(eq(sources.id, s.sourceId)).run();
    createTinvestSource(s.db, 'u1', 't.revoked');
    const broken = s.db.select({ id: sources.id }).from(sources).all().at(-1)!.id;
    s.db.update(finAccounts).set({ sourceId: broken }).run();
    enqueueSync(s.db, broken, 'schedule');
    // Only the sync job: the recalculations it would queue next reach for prices over the network.
    await runOnce({
      db: s.db,
      workerId: 'w',
      definitions: [syncTinvest as JobDefinition<never>],
      schedules: [],
      log: log.root.child({ source: 'jobs' }),
    });
    log.sink.flush();

    const errors = (await s.call('GET', '/logs?level=error')).json.logs as {
      jobId: string | null;
      message: string;
    }[];
    const failed = errors.find((l) => l.jobId);
    expect(failed).toBeDefined();
    const related = (await s.call('GET', `/logs?jobId=${failed!.jobId}`)).json.logs as {
      message: string;
      level: string;
    }[];
    expect(related.length).toBeGreaterThan(1);
    expect(
      related.some((l) => /GetAccounts|GetOperationsByCursor/.test(l.message) || l.message === 'Job failed'),
    ).toBe(true);
    const runs = (await s.call('GET', `/sync/runs?sourceId=${broken}`)).json.runs as {
      status: string;
      error: string;
    }[];
    expect(runs[0]).toMatchObject({ status: 'error', error: 'Токен не найден или отозван. Выпустите новый' });
  });
});
