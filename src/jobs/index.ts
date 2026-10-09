import type { ScheduleDef } from './queue';
import type { JobDefinition } from './runner';
import { refreshPricesJob, snapshotJob } from './market';
import { recalcPositions } from './positions';
import { cleanupJob, heartbeat } from './system';
import { syncDue, syncTinvest } from './tinvest-sync';
import { refreshPayoutsJob } from './payouts';
import { accrueInterestJob } from './interest';

export const jobDefinitions: JobDefinition<never>[] = [
  heartbeat as JobDefinition<never>,
  cleanupJob as JobDefinition<never>,
  recalcPositions as JobDefinition<never>,
  refreshPricesJob as JobDefinition<never>,
  snapshotJob as JobDefinition<never>,
  syncTinvest as JobDefinition<never>,
  syncDue as JobDefinition<never>,
  refreshPayoutsJob as JobDefinition<never>,
  accrueInterestJob as JobDefinition<never>,
];

export const schedules: ScheduleDef[] = [
  { name: heartbeat.name, cron: '* * * * *' },
  { name: cleanupJob.name, cron: '7 * * * *' },
  { name: refreshPricesJob.name, cron: '*/15 * * * *' },
  // Every 10 minutes: cheap when nothing is behind; catches the snapshot time and missed days.
  { name: snapshotJob.name, cron: '*/10 * * * *' },
  // Each source has its own interval (15 minutes by default); this only checks who is due.
  { name: syncDue.name, cron: '* * * * *' },
  // Coupon and dividend schedules change rarely: once a day, early morning UTC.
  { name: refreshPayoutsJob.name, cron: '0 3 * * *' },
  { name: accrueInterestJob.name, cron: '20 3 * * *' },
];

/** Run once when the worker starts: fill gaps left while it was down. */
export const startupJobs = [
  refreshPricesJob.name,
  snapshotJob.name,
  refreshPayoutsJob.name,
  accrueInterestJob.name,
];
