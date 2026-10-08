import { hostname } from 'node:os';
import { db } from '@/db/client';
import { jobDefinitions, schedules, startupJobs } from '@/jobs';
import { finAccounts } from '@/db/schema';
import { enqueueRecalc } from '@/jobs/positions';
import { enqueue } from '@/jobs/queue';
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
for (const name of startupJobs) enqueue(db(), name, null, { singletonKey: name });
// Positions are derived: rebuilding them on start applies any change in the calculation rules.
for (const { id } of db().select({ id: finAccounts.id }).from(finAccounts).all()) enqueueRecalc(db(), id);
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
