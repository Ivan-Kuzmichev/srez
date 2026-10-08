import { z } from 'zod';
import { APP_NAME } from '@/lib/app';
import { APP_VERSION } from '../health';
import { endpoints } from './endpoints';

const ERROR = {
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: { code: { type: 'string' }, message: { type: 'string' } },
      required: ['code', 'message'],
    },
  },
};

/** GET /api/v1/openapi.json: built from the same Zod schemas that check the requests (docs/06-api.md). */
export function openApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of endpoints) {
    const parameters: unknown[] = [];
    for (const name of [...e.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))
      parameters.push({ name, in: 'path', required: true, schema: { type: 'string' } });
    if (e.query) {
      const schema = z.toJSONSchema(e.query, { io: 'input', unrepresentable: 'any' }) as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      for (const [name, s] of Object.entries(schema.properties ?? {}))
        parameters.push({ name, in: 'query', required: schema.required?.includes(name) ?? false, schema: s });
    }
    paths[e.path] ??= {};
    paths[e.path]![e.method.toLowerCase()] = {
      summary: e.summary,
      'x-scope': e.scope,
      security: [{ bearer: [] }],
      parameters,
      ...(e.body
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: z.toJSONSchema(e.body, { io: 'input', unrepresentable: 'any' }),
                },
              },
            },
          }
        : {}),
      responses: {
        200: {
          description: 'JSON. Decimals are strings, dates ISO 8601.',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        400: { description: 'Bad input', content: { 'application/json': { schema: ERROR } } },
        401: {
          description: 'Unknown, revoked or expired token',
          content: { 'application/json': { schema: ERROR } },
        },
        403: {
          description: 'Missing right, or a local-only token from outside',
          content: { 'application/json': { schema: ERROR } },
        },
        429: {
          description: '60 requests a minute per token',
          content: { 'application/json': { schema: ERROR } },
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: `${APP_NAME} API`,
      version: APP_VERSION,
      description:
        'Read access for an assistant: data, logs, sync status. Rights: read:data, read:logs, run:sync. Pagination: limit (up to 500) and cursor; the answer carries nextCursor.',
    },
    servers: [{ url: '/api/v1' }],
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', description: 'inv_… token from Настройки → Разработка' },
      },
    },
    paths,
  };
}
