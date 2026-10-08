import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { actionKind, authedAction } from '../action';

const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../session', () => ({ getSession: async () => session.current }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

// Every module with server actions. New files are picked up automatically.
const modules = import.meta.glob('./*.ts', { eager: true }) as Record<string, Record<string, unknown>>;
const PUBLIC_ALLOWED = new Set(['./auth.ts:signInWithPassword', './auth.ts:verifySecondFactor']);

beforeEach(() => {
  session.current = null;
});

describe('server actions', () => {
  const exported = Object.entries(modules)
    .filter(([path]) => !path.endsWith('.test.ts'))
    .flatMap(([path, mod]) => Object.entries(mod).map(([name, fn]) => ({ id: `${path}:${name}`, fn })));

  it('are found', () => {
    expect(exported.length).toBeGreaterThan(0);
  });

  it('are all declared through authedAction, except the sign-in steps', () => {
    for (const { id, fn } of exported) {
      const kind = actionKind(fn);
      expect(kind, id).toBeDefined();
      if (kind === 'public') expect(PUBLIC_ALLOWED.has(id), `${id} must not be public`).toBe(true);
    }
  });

  it('refuse to run without a session', async () => {
    for (const { id, fn } of exported) {
      if (actionKind(fn) !== 'authed') continue;
      const result = await (fn as (prev: unknown, input: unknown) => Promise<{ ok: boolean; code?: string }>)(
        null,
        new FormData(),
      );
      expect(result, id).toEqual({ ok: false, code: 'UNAUTHORIZED' });
    }
  });
});

describe('authedAction', () => {
  const handler = vi.fn(async (input: { n: number }) => ({ ok: true as const, data: input.n * 2 }));
  const action = authedAction(z.object({ n: z.coerce.number().int() }), handler);

  it('validates input before the handler sees it', async () => {
    session.current = { user: { id: 'u' }, session: { id: 's' } };
    const bad = await action(null, { n: 'abc' });
    expect(bad).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(handler).not.toHaveBeenCalled();
    const form = new FormData();
    form.set('n', '21');
    expect(await action(null, form)).toEqual({ ok: true, data: 42 });
  });
});
