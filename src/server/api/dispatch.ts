import { z } from 'zod';
import type { Db } from '@/db/client';
import { checkToken } from '../api-tokens';
import { CLIENT_IP_HEADER } from '../client-ip';
import { logContext } from '../log-context';
import { logger } from '../logger';
import { RateLimiter } from '../rate-limit';
import { ApiError, matchPath, toJson } from './core';
import { endpoints } from './endpoints';
import { openApiDocument } from './openapi';

/** docs/06-api.md, section 1: 60 requests a minute per token. */
const limiter = new RateLimiter(60, 60_000);

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(toJson(body)), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
const fail = (e: ApiError, headers?: Record<string, string>) =>
  json(e.status, { error: { code: e.code, message: e.message } }, headers);

/** One call to /api/v1/…: token, network, right, limit, input, handler, a log line (section 6). */
export async function dispatch(
  db: Db,
  request: Request,
  segments: string[],
  now = new Date(),
): Promise<Response> {
  const requestId = request.headers.get('x-request-id') ?? undefined;
  return logContext.run({ requestId }, () => handle(db, request, segments, now));
}

async function handle(db: Db, request: Request, segments: string[], now: Date): Promise<Response> {
  const started = Date.now();
  const path = `/${segments.join('/')}`;
  const method = request.method;
  if (method === 'GET' && path === '/openapi.json') return json(200, openApiDocument());

  const ip = request.headers.get(CLIENT_IP_HEADER);
  const log = logger('api', { requestId: request.headers.get('x-request-id') ?? undefined });
  let tokenName: string | null = null;
  const finish = (res: Response) => {
    const ms = Date.now() - started;
    const line = `${method} /api/v1${path} ${res.status}, ${ms} ms${tokenName ? `, токен «${tokenName}»` : ''}${ip ? `, ${ip}` : ''}`;
    const ctx = { method, path, status: res.status, durationMs: ms, token: tokenName, ip };
    if (res.status >= 500) log.error(ctx, line);
    else if (res.status === 401 || res.status === 403) log.warn(ctx, line);
    else log.info(ctx, line);
    return res;
  };

  const check = checkToken(db, request.headers.get('authorization'), ip, `/api/v1${path}`, now);
  if (!check.ok) return finish(fail(new ApiError(check.status, check.code, check.message)));
  const token = check.token;
  tokenName = token.name;

  let match: { e: (typeof endpoints)[number]; params: Record<string, string> } | null = null;
  let pathKnown = false;
  for (const e of endpoints) {
    const params = matchPath(e.path, segments);
    if (!params) continue;
    pathKnown = true;
    if (e.method === method) {
      match = { e, params };
      break;
    }
  }
  if (!match)
    return finish(
      fail(
        pathKnown
          ? new ApiError(405, 'METHOD_NOT_ALLOWED', `${method} is not supported here`)
          : new ApiError(404, 'NOT_FOUND', 'No such method'),
      ),
    );
  if (!token.scopes.includes(match.e.scope))
    return finish(fail(new ApiError(403, 'FORBIDDEN', `The token lacks the «${match.e.scope}» right`)));
  if (!limiter.hit(token.id, now.getTime()))
    return finish(
      fail(new ApiError(429, 'RATE_LIMITED', '60 requests a minute per token'), { 'retry-after': '60' }),
    );

  try {
    const url = new URL(request.url);
    const query = match.e.query
      ? match.e.query.safeParse(Object.fromEntries(url.searchParams))
      : { success: true as const, data: {} };
    if (!query.success) throw new ApiError(400, 'INVALID_QUERY', z.prettifyError(query.error));
    let body: unknown = {};
    if (match.e.body) {
      const raw = await request.json().catch(() => {
        throw new ApiError(400, 'INVALID_BODY', 'Body is not JSON');
      });
      const parsed = match.e.body.safeParse(raw);
      if (!parsed.success) throw new ApiError(400, 'INVALID_BODY', z.prettifyError(parsed.error));
      body = parsed.data;
    }
    const result = await match.e.handler({
      db,
      userId: token.userId,
      token,
      params: match.params,
      query: query.data,
      body,
      now,
    });
    return finish(json(200, result));
  } catch (err) {
    if (err instanceof ApiError) return finish(fail(err));
    log.error({ err, path }, 'API handler failed');
    return finish(fail(new ApiError(500, 'INTERNAL', 'Internal error, see the logs by request id')));
  }
}
