import type { ScheduleDef } from './queue';
import type { JobDefinition } from './runner';
import { refreshPricesJob, snapshotJob } from './market';
import { recalcPositions } from './positions';
import { heartbeat } from './system';

export const jobDefinitions: JobDefinition<never>[] = [
  heartbeat as JobDefinition<never>,
  recalcPositions as JobDefinition<never>,
  refreshPricesJob as JobDefinition<never>,
  snapshotJob as JobDefinition<never>,
];

export const schedules: ScheduleDef[] = [
  { name: heartbeat.name, cron: '* * * * *' },
  { name: refreshPricesJob.name, cron: '*/15 * * * *' },
  // Every 10 minutes: cheap when nothing is behind; catches the snapshot time and missed days.
  { name: snapshotJob.name, cron: '*/10 * * * *' },
];

/** Run once when the worker starts: fill gaps left while it was down. */
export const startupJobs = [refreshPricesJob.name, snapshotJob.name];
