import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The job or the API request being handled. Every log line written inside carries its id, also the
 * lines of shared code that does not know about either (external requests), so one id finds all.
 */
export const logContext = new AsyncLocalStorage<{ jobId?: string; requestId?: string }>();
