import { headers } from 'next/headers';
import { REQUEST_ID_HEADER } from '@/proxy';
import { logger, type LogSource, type Logger } from './logger';

/** Logger bound to the current request id. For server components, actions and route handlers. */
export async function requestLogger(source: LogSource = 'web'): Promise<Logger> {
  const requestId = (await headers()).get(REQUEST_ID_HEADER) ?? undefined;
  return logger(source, requestId ? { requestId } : {});
}
