import { Writable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { logs, sources, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { tinvestToken } from '@/jobs/source-token';
import { createLogger } from '@/server/logger';
import { createTinvestSource, replaceTinvestToken } from './sources';

function setup() {
  const db = createTestDb();
  const now = new Date();
  for (const id of ['u1', 'u2'])
    db.insert(user)
      .values({ id, name: id, email: `${id}@local.invalid`, createdAt: now, updatedAt: now })
      .run();
  return db;
}

const TOKEN = 't.secret-broker-token-for-tests';

describe('T-Invest source token', () => {
  it('is stored encrypted and read back only through the worker helper', () => {
    const db = setup();
    const id = createTinvestSource(db, 'u1', TOKEN);
    const row = db.select().from(sources).where(eq(sources.id, id)).get()!;
    expect(Buffer.from(row.secretEncrypted!).toString('latin1')).not.toContain('secret-broker');
    expect(JSON.stringify(row)).not.toContain('secret-broker');
    expect(row.scheduleMinutes).toBe(15);
    expect(tinvestToken(db, id)).toBe(TOKEN);

    expect(replaceTinvestToken(db, 'u1', id, 't.new-token')).toBe(true);
    expect(tinvestToken(db, id)).toBe('t.new-token');
    expect(replaceTinvestToken(db, 'u2', id, 't.stolen')).toBe(false);
    expect(tinvestToken(db, id)).toBe('t.new-token');
  });

  it('never reaches the logs, even when a whole source row is logged', () => {
    const db = setup();
    const id = createTinvestSource(db, 'u1', TOKEN);
    const row = db.select().from(sources).where(eq(sources.id, id)).get()!;
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const { root, sink } = createLogger({ level: 'info', getDb: () => db, console: stream });
    root.child({ source: 'collector' }).info({ source: row, token: TOKEN }, 'source loaded');
    sink.flush();
    const stored = JSON.stringify(db.select().from(logs).all());
    for (const text of [lines.join('\n'), stored]) {
      expect(text).not.toContain('secret-broker');
      expect(text).toContain('[redacted]');
    }
  });
});
