import { z } from 'zod';
import { defineJob } from './runner';

/** Test job from phase 0: proves the worker, the schedule and the log table are alive. */
export const heartbeat = defineJob({
  name: 'system.heartbeat',
  payload: z.null(),
  handler({ log }) {
    log.info('Worker heartbeat');
  },
});
