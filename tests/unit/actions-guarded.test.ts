import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACTION_KIND } from '@/server/action';

// NFR-1, rule 5: every server action checks the session — it is built with authedAction. Only the
// sign-in steps may run without one (publicAction), and they are listed here by name.
const PUBLIC = new Set(['signInWithPassword', 'verifySecondFactor']);

describe('server actions', () => {
  it('are all guarded, except the sign-in steps', async () => {
    const offenders: string[] = [];
    for (const file of readdirSync('src/server/actions').filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
    )) {
      const mod = (await import(`@/server/actions/${file.replace(/\.ts$/, '')}`)) as Record<string, unknown>;
      for (const [name, value] of Object.entries(mod)) {
        if (typeof value !== 'function') continue;
        const kind = (value as { [ACTION_KIND]?: string })[ACTION_KIND];
        if (kind === 'authed') continue;
        if (kind === 'public' && PUBLIC.has(name)) continue;
        offenders.push(`${file}: ${name} (${kind ?? 'unguarded'})`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
