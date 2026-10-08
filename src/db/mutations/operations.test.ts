import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { jobs, operations, positions, tags } from '@/db/schema';
import { insertOperation, seedAccount, seedShare } from '@/db/test-fixtures';
import { createTestDb } from '@/db/test-db';
import { parseOperationForm, type OperationFormInput } from '@/server/operation-form';
import {
  createOperation,
  deleteOperation,
  OperationError,
  previewOperation,
  updateOperation,
} from './operations';
import { recalcAccount } from './positions';

const form = (over: Partial<OperationFormInput> = {}): OperationFormInput => ({
  kind: 'buy',
  subtype: '',
  accountId: 'a1',
  executedAt: '2026-10-05T19:40',
  instrumentId: 'sber',
  quantity: '100',
  price: '312,10',
  currency: 'RUB',
  fee: '',
  total: '',
  tax: '',
  tagId: '',
  note: '',
  ...over,
});
const parsed = (over: Partial<OperationFormInput> = {}) => {
  const r = parseOperationForm(form(over), new Date('2026-10-08T00:00:00Z'));
  if (!r.ok) throw new Error(JSON.stringify(r.fieldErrors));
  return r.value;
};

function setup() {
  const db = createTestDb();
  seedAccount(db);
  seedShare(db);
  return db;
}

describe('parseOperationForm', () => {
  it('reads Russian number input and Moscow time', () => {
    const v = parsed();
    expect(v.executedAt.toISOString()).toBe('2026-10-05T16:40:00.000Z');
    expect(v.fields.amount.toFixed()).toBe('-31210');
  });

  it('reports field errors by name', () => {
    const r = parseOperationForm(form({ quantity: 'много', price: '0', instrumentId: '', executedAt: '' }));
    expect(r).toEqual({
      ok: false,
      fieldErrors: {
        quantity: 'NOT_A_NUMBER',
        price: 'MUST_BE_POSITIVE',
        instrumentId: 'REQUIRED',
        executedAt: 'REQUIRED',
      },
    });
  });

  it('builds payouts, cash flows and charges', () => {
    expect(parsed({ kind: 'payout', subtype: 'coupon', total: '4248', tax: '' }).fields).toMatchObject({
      type: 'coupon',
    });
    const w = parsed({ kind: 'cashflow', subtype: 'withdrawal', total: '1 000', instrumentId: 'sber' });
    expect([w.fields.type, w.fields.amount.toFixed(), w.instrumentId]).toEqual(['withdrawal', '-1000', null]);
  });
});

describe('operations', () => {
  it('create queues a recalc, and the recalc gives the position', () => {
    const db = setup();
    createOperation(db, 'u1', parsed());
    expect(db.select().from(jobs).get()).toMatchObject({
      name: 'positions.recalc',
      payload: { accountId: 'a1' },
    });
    recalcAccount(db, 'a1');
    expect(db.select().from(positions).where(eq(positions.instrumentId, 'sber')).get()?.quantity).toBe('100');
  });

  it("refuse someone else's account, instrument or tag", () => {
    const db = setup();
    expect(() => createOperation(db, 'u2', parsed())).toThrow(OperationError);
    db.insert(tags).values({ id: 't-other', userId: 'u1', name: 'x' }).run();
    expect(() => createOperation(db, 'u1', parsed({ instrumentId: 'nope' }))).toThrow(/INSTRUMENT/);
  });

  it('imported operations keep everything but the tag and the note', () => {
    const db = setup();
    const id = insertOperation(db, {
      type: 'buy',
      instrumentId: 'sber',
      quantity: '1',
      price: '1',
      origin: 'tinvest',
      externalId: 'x',
    });
    expect(() => updateOperation(db, 'u1', id, parsed())).toThrow(/IMPORTED/);
    expect(() => deleteOperation(db, 'u1', id)).toThrow(/IMPORTED/);
    db.insert(tags).values({ id: 'pension', userId: 'u1', name: 'пенсия' }).run();
    updateOperation(db, 'u1', id, { tagId: 'pension', note: 'долгосрок' });
    expect(db.select().from(operations).where(eq(operations.id, id)).get()).toMatchObject({
      tagId: 'pension',
      note: 'долгосрок',
      quantity: '1',
    });
  });

  it('delete removes a manual operation and queues a recalc', () => {
    const db = setup();
    const id = createOperation(db, 'u1', parsed());
    db.delete(jobs).run();
    deleteOperation(db, 'u1', id);
    expect(db.select().from(operations).all()).toHaveLength(0);
    expect(db.select().from(jobs).all()).toHaveLength(1);
  });

  it('preview shows the change without saving', () => {
    const db = setup();
    createOperation(db, 'u1', parsed({ quantity: '100', price: '300' }));
    const p = previewOperation(db, 'u1', parsed({ quantity: '100', price: '310' }))!;
    expect([p.quantityBefore.toFixed(), p.quantityAfter.toFixed(), p.avgPriceAfter!.toFixed()]).toEqual([
      '100',
      '200',
      '305',
    ]);
    expect(db.select().from(operations).all()).toHaveLength(1);
  });

  it('preview of an edit leaves the edited operation out of «before»', () => {
    const db = setup();
    const id = createOperation(db, 'u1', parsed({ quantity: '100', price: '300' }));
    const p = previewOperation(db, 'u1', parsed({ quantity: '50', price: '300' }), id)!;
    expect([p.quantityBefore.toFixed(), p.quantityAfter.toFixed()]).toEqual(['0', '50']);
  });
});
