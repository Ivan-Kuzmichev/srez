import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NETWORKS } from '@/integrations/chains/networks';

// NFR-2: the service reaches only the hosts of docs/05-integrations.md, section 7. A new host in the
// code fails here until the list (and the owner) agree.
const ALLOWED = new Set([
  'invest-public-api.tbank.ru',
  'iss.moex.com',
  'www.cbr.ru',
  'api.coingecko.com',
  'api.telegram.org',
  'api.blockscout.com',
  ...NETWORKS.flatMap((n) => n.endpoints.map((e) => new URL(e).host)),
]);
// Not requests: the SVG namespace, local addresses.
const NOT_REQUESTS = new Set(['www.w3.org', 'localhost', 'localhost:3000']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('outbound hosts', () => {
  it('application code names only the agreed hosts', () => {
    const found = new Map<string, string>();
    for (const file of files('src'))
      for (const m of readFileSync(file, 'utf8').matchAll(/['"`]https?:\/\/([^/'"`$\s]+)/g)) {
        const host = m[1]!;
        if (!ALLOWED.has(host) && !NOT_REQUESTS.has(host) && !host.startsWith('127.0.0.1'))
          found.set(host, file);
      }
    expect(Object.fromEntries(found)).toEqual({});
  });
});
