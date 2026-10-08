import type { z } from 'zod';
import type { Db } from '@/db/client';
import type { ApiScope } from '@/db/schema';
import type { ApiTokenRow } from '../api-tokens';

/** `{ "error": { "code", "message" } }` with its HTTP status (docs/06-api.md, section 1). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiError(404, 'NOT_FOUND', `${what} not found`);

export interface ApiContext<Q, B> {
  db: Db;
  userId: string;
  token: ApiTokenRow;
  params: Record<string, string>;
  query: Q;
  body: B;
  now: Date;
}

export interface Endpoint<Q = unknown, B = unknown> {
  method: 'GET' | 'POST';
  /** «/portfolios/{id}» */
  path: string;
  scope: ApiScope;
  summary: string;
  query?: z.ZodType<Q>;
  body?: z.ZodType<B>;
  handler(ctx: ApiContext<Q, B>): unknown | Promise<unknown>;
}

export function endpoint<Q = Record<string, never>, B = Record<string, never>>(
  e: Endpoint<Q, B>,
): Endpoint<Q, B> {
  return e;
}

/** «/portfolios/{id}» against «portfolios/0193…»: the params, or null. */
export function matchPath(pattern: string, segments: string[]): Record<string, string> | null {
  const parts = pattern.split('/').filter(Boolean);
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (const [i, part] of parts.entries()) {
    const seg = segments[i]!;
    if (part.startsWith('{')) params[part.slice(1, -1)] = decodeURIComponent(seg);
    else if (part !== seg) return null;
  }
  return params;
}

/** Decimals and dates as JSON wants them in this API: decimals as strings, dates as ISO strings. */
export function toJson(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'toFixed' in value && 'isFinite' in value) return String(value);
  if (Array.isArray(value)) return value.map(toJson);
  if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [k, toJson(v)]));
  if (typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJson(v)]));
  return value;
}
