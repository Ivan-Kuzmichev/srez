import { describe, expect, it } from 'vitest';
import { settings, user } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import { getSettings, updateSettings } from './settings';

function setup() {
  const db = createTestDb();
  const now = new Date();
  db.insert(user)
    .values({ id: 'u1', name: 'o', email: 'o@local.invalid', createdAt: now, updatedAt: now })
    .run();
  return db;
}

describe('settings', () => {
  it('fall back to defaults without a row', () => {
    const s = getSettings(setup(), 'u1');
    expect(s.prices).toEqual({ refreshMinutes: 15, snapshotTime: '23:50' });
    expect(s.display.timezone).toBe('Europe/Moscow');
  });

  it('merge a section change and keep the rest', () => {
    const db = setup();
    updateSettings(db, 'u1', { prices: { snapshotTime: '22:00' } });
    const s = getSettings(db, 'u1');
    expect(s.prices).toEqual({ refreshMinutes: 15, snapshotTime: '22:00' });
    expect(s.returns.primaryMetric).toBe('xirr');
  });

  it('reject invalid values and survive a broken row', () => {
    const db = setup();
    expect(() => updateSettings(db, 'u1', { prices: { snapshotTime: '25:00' } })).toThrow();
    db.insert(settings)
      .values({ userId: 'u1', data: { prices: { refreshMinutes: 7 } }, updatedAt: new Date() })
      .run();
    expect(getSettings(db, 'u1').prices.refreshMinutes).toBe(15);
  });
});
