import { execSync } from 'node:child_process';

/** Stops the e2e worker started next to the server (marked with the «e2e» argument). */
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
}
