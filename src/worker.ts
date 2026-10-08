import { hostname } from 'node:os';
import { db } from '@/db/client';
import { jobDefinitions, schedules } from '@/jobs';
import { startWorker } from '@/jobs/runner';
import { flushLogs, logger } from '@/server/logger';

const log = logger('jobs');

const worker = startWorker({
  db: db(),
  workerId: `${hostname()}:${process.pid}`,
  definitions: jobDefinitions,
  schedules,
  log,
});
log.info({ jobs: jobDefinitions.map((d) => d.name) }, 'Worker started');

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'Worker stopping');
  await worker.stop();
  flushLogs();
  db().$client.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
