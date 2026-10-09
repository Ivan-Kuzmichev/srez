import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { MOCK_BLOCKSCOUT_KEY } from '../mock/chains';
import { MOCK_TOKEN } from '../mock/tinvest';
import { MOCK_TELEGRAM_TOKEN } from '../mock/telegram';
import * as users from './users';
import { E2E_AUTH_SECRET, E2E_SECRET_KEY } from './secrets';

/**
 * Phase 10, NFR-1: after the whole run no secret is anywhere in the database in plain text — logs,
 * raw answers, job errors, settings. The raw bytes of the file and its WAL are searched.
 */
function scanForSecrets(): void {
  const secrets = [
    MOCK_TOKEN,
    MOCK_TELEGRAM_TOKEN,
    MOCK_BLOCKSCOUT_KEY,
    E2E_AUTH_SECRET,
    E2E_SECRET_KEY,
    ...Object.values(users).map((u) => u.password),
  ];
  const found: string[] = [];
  for (const file of ['data/e2e.db', 'data/e2e.db-wal']) {
    if (!existsSync(file)) continue;
    const bytes = readFileSync(file);
    for (const s of secrets)
      if (bytes.includes(Buffer.from(s, 'utf8'))) found.push(`${file}: ${s.slice(0, 6)}…`);
  }
  if (found.length) throw new Error(`Secrets in plain text after the e2e run:\n${found.join('\n')}`);
}

/** Stops the e2e worker started next to the server (marked with the «e2e» argument), then scans for secrets. */
export default function globalTeardown() {
  for (const pattern of [
    'src/worker.ts e2e',
    'tests/mock/tinvest.ts',
    'tests/mock/chains.ts',
    'tests/mock/telegram.ts',
  ]) {
    try {
      execSync(`pkill -f "${pattern}"`);
    } catch {
      // Not running: nothing to stop.
    }
  }
  scanForSecrets();
}
