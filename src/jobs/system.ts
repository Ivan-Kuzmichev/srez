import { z } from 'zod';
import { logs } from '@/db/schema';
import { defineJob } from './runner';

/** Test job from phase 0: proves the worker and the schedule are alive. */
export const heartbeat = defineJob({
  name: 'system.heartbeat',
  payload: z.null(),
  handler({ db, jobId }) {
    db.insert(logs)
      .values({ ts: new Date(), level: 'info', source: 'jobs', message: 'Worker heartbeat', jobId })
      .run();
  },
});
