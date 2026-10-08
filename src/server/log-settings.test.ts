import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { logs, rawResponses, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { cleanup } from '@/jobs/system';
import {
  applyLogSettings,
  createLogger,
  logConfig,
  maskAmounts,
  maskMessage,
  observeExternalRequest,
} from './logger';
import { getSettings, SettingsSchema, updateSettings } from './settings';

const silent = new Writable({ write: (_c, _e, cb) => cb() });
const defaults = () => SettingsSchema.parse({});
afterEach(() => applyLogSettings(defaults()));

function setup() {
  const db = createTestDb();
  const now = new Date('2026-10-08T12:00:00Z');
  db.insert(user)
    .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
    .run();
  const { root, sink } = createLogger({ level: 'info', getDb: () => db, console: silent });
  return { db, root, sink, now };
}

describe('log settings', () => {
  it('turn debug on until the set time and fall back to the chosen level after it', () => {
    const s = {
      ...defaults(),
      logging: { ...defaults().logging, level: 'warn' as const },
      debug: { enabled: true, autoOffAt: 2_000 },
    };
    applyLogSettings(s, 1_000);
    expect([logConfig.level, logConfig.debug]).toEqual(['debug', true]);
    applyLogSettings(s, 3_000);
    expect([logConfig.level, logConfig.debug]).toEqual(['warn', false]);
  });

  it('change the threshold of loggers created before the change', () => {
    const { db, root, sink } = setup();
    const early = root.child({ source: 'jobs' });
    early.debug('hidden');
    applyLogSettings({ ...defaults(), debug: { enabled: true, autoOffAt: null } });
    early.debug('shown');
    applyLogSettings({ ...defaults(), logging: { ...defaults().logging, level: 'error' } });
    early.warn('hidden too');
    sink.flush();
    expect(
      db
        .select({ m: logs.message })
        .from(logs)
        .all()
        .map((r) => r.m),
    ).toEqual(['shown']);
  });

  it('drop routine sign-in and API entries when asked, keeping warnings', () => {
    const { db, root, sink } = setup();
    applyLogSettings({ ...defaults(), logging: { ...defaults().logging, authEvents: false } });
    root.child({ source: 'auth' }).info('signed in');
    root.child({ source: 'auth' }).warn('wrong password');
    root.child({ source: 'api' }).info('GET /api/v1/health');
    root.child({ source: 'jobs' }).info('kept');
    sink.flush();
    expect(
      db
        .select({ m: logs.message })
        .from(logs)
        .all()
        .map((r) => r.m),
    ).toEqual(['wrong password', 'kept']);
  });

  it('mask amounts and quantities, in messages and in amount-like fields', () => {
    expect(maskMessage('Bought 1 250 SBER at 291,40 for 364 250 ₽')).toBe('Bought ••• SBER at ••• for ••• ₽');
    expect(
      maskAmounts({
        amount: '-6525',
        price: 130.5,
        quantity: '50',
        status: 200,
        accountId: 'a1',
        nested: [{ payment: '1' }],
      }),
    ).toEqual({
      amount: '•••',
      price: '•••',
      quantity: '•••',
      status: 200,
      accountId: 'a1',
      nested: [{ payment: '•••' }],
    });
    const { db, root, sink } = setup();
    applyLogSettings({ ...defaults(), logging: { ...defaults().logging, maskAmounts: true } });
    root.child({ source: 'collector' }).info({ amount: '100' }, 'Imported 42 operations');
    sink.flush();
    const row = db.select().from(logs).get()!;
    expect(row.message).toBe('Imported ••• operations');
    expect(row.context).toMatchObject({ amount: '•••' });
  });

  it('keep raw answers only in debug mode, with secrets cut out', () => {
    const { db } = setup();
    const request = {
      integration: 'tinvest' as const,
      method: 'UsersService/GetAccounts',
      status: 200,
      durationMs: 120,
      body: '{"accounts":[],"token":"t.leak"}',
    };
    observeExternalRequest(request, () => db);
    expect(db.select().from(rawResponses).all()).toHaveLength(0);
    applyLogSettings({ ...defaults(), debug: { enabled: true, autoOffAt: null } });
    observeExternalRequest(request, () => db);
    const raw = db.select().from(rawResponses).all();
    expect(raw).toHaveLength(1);
    expect(raw[0]).toMatchObject({ integration: 'tinvest', status: 200, durationMs: 120 });
    expect(JSON.stringify(raw[0]!.body)).not.toContain('t.leak');
  });

  it('cleanup removes old logs and raw answers and switches debug off on time', () => {
    const { db, now } = setup();
    updateSettings(db, 'u1', {
      logging: { retentionDays: 7 },
      debug: { enabled: true, autoOffAt: now.getTime() - 1 },
    });
    const day = 86_400_000;
    db.insert(logs)
      .values([
        { ts: new Date(now.getTime() - 8 * day), level: 'info', source: 'jobs', message: 'old' },
        { ts: new Date(now.getTime() - 6 * day), level: 'info', source: 'jobs', message: 'recent' },
      ])
      .run();
    db.insert(rawResponses)
      .values([
        {
          ts: new Date(now.getTime() - 2 * day),
          integration: 'cbr',
          method: 'GET /x',
          status: 200,
          durationMs: 1,
        },
        {
          ts: new Date(now.getTime() - 3_600_000),
          integration: 'cbr',
          method: 'GET /x',
          status: 200,
          durationMs: 1,
        },
      ])
      .run();
    expect(cleanup(db, now)).toEqual({ logs: 1, raw: 1, debugOff: true });
    expect(
      db
        .select({ m: logs.message })
        .from(logs)
        .all()
        .map((r) => r.m),
    ).toEqual(['recent']);
    expect(getSettings(db, 'u1').debug).toEqual({ enabled: false, autoOffAt: null });
  });
});

describe('log context', () => {
  it('stamps every line written inside a job with its id', async () => {
    const { db, root, sink } = setup();
    const { logContext } = await import('./log-context');
    await logContext.run({ jobId: 'job_9' }, async () => {
      root.child({ source: 'collector' }).info('inside');
    });
    root.child({ source: 'collector' }).info('outside');
    sink.flush();
    expect(db.select({ m: logs.message, j: logs.jobId }).from(logs).all()).toEqual([
      { m: 'inside', j: 'job_9' },
      { m: 'outside', j: null },
    ]);
  });
});
