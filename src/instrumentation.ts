import type { Instrumentation } from 'next';

/** Server errors go to the `logs` table with the request id set by the proxy. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { logger } = await import('@/server/logger');
  const requestId = request.headers['x-request-id'];
  const digest = typeof err === 'object' && err !== null && 'digest' in err ? String(err.digest) : undefined;
  logger('web', typeof requestId === 'string' ? { requestId } : {}).error(
    { err, digest, method: request.method, path: request.path, route: context.routePath, kind: context.routeType },
    'Request failed',
  );
};
