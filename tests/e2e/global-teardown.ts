import { execSync } from 'node:child_process';

/** Stops the e2e worker started next to the server (marked with the «e2e» argument). */
export default function globalTeardown() {
  try {
    execSync('pkill -f "src/worker.ts e2e"');
  } catch {
    // Not running: nothing to stop.
  }
}
