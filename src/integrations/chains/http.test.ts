import { describe, expect, it } from 'vitest';
import { requestJson } from './http';

describe('endpoints with fallbacks', () => {
  const parse = (b: unknown) => b as { ok: boolean };
  it('takes the next endpoint after a network error, a 429 or a 5xx', async () => {
    const seen: string[] = [];
    const fetchFn = async (url: string) => {
      seen.push(url);
      if (url.startsWith('https://a')) throw new TypeError('fetch failed');
      if (url.startsWith('https://b')) return new Response('', { status: 429 });
      if (url.startsWith('https://c')) return new Response('', { status: 502 });
      return new Response('{"ok":true}');
    };
    const r = await requestJson('evm', ['https://a', 'https://b', 'https://c', 'https://d'], '/x', {
      method: 'test',
      fetchFn,
      parse,
    });
    expect(r).toEqual({ ok: true });
    expect(seen).toEqual(['https://a/x', 'https://b/x', 'https://c/x', 'https://d/x']);
  });

  it('stops on a refused key, and on a body the caller rejects tries the next', async () => {
    const fetch401 = async () => new Response('', { status: 401 });
    await expect(
      requestJson('blockscout', ['https://a', 'https://b'], '', { method: 't', fetchFn: fetch401, parse }),
    ).rejects.toMatchObject({ status: 401 });
    let n = 0;
    const fetchBad = async () => new Response(n++ === 0 ? '{"bad":1}' : '{"ok":true}');
    const strict = (b: unknown) => {
      if (!(b as { ok?: boolean }).ok) throw new Error('bad body');
      return b;
    };
    await expect(
      requestJson('evm', ['https://a', 'https://b'], '', { method: 't', fetchFn: fetchBad, parse: strict }),
    ).resolves.toEqual({ ok: true });
  });
});
