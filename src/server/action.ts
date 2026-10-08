import { z } from 'zod';
import { logger } from './logger';
import { getSession, type SessionData } from './session';

/** Every server action returns this; screens show `message` or `fieldErrors` and keep the form. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: string;
      message?: string;
      fieldErrors?: Record<string, string[]>;
      /** Extra facts for the screen, e.g. attempts left or when a lock ends. */
      details?: Record<string, string | number | boolean>;
    };

export const ACTION_KIND = Symbol.for('srez.action-kind');
type Marked = { [ACTION_KIND]?: 'authed' | 'public' };

function toInput(raw: unknown): unknown {
  if (!(raw instanceof FormData)) return raw;
  const out: Record<string, unknown> = {};
  for (const [key, value] of raw.entries()) {
    if (key.startsWith('$ACTION')) continue;
    out[key] = value;
  }
  return out;
}

function invalid(error: z.ZodError): ActionResult<never> {
  return {
    ok: false,
    code: 'INVALID_INPUT',
    fieldErrors: z.flattenError(error).fieldErrors as Record<string, string[]>,
  };
}

/**
 * The only way to declare a server action that needs a signed-in user (docs/07-auth-security.md, section 6).
 * Usable directly or with useActionState: `(prevState, input)`, input may be FormData.
 */
export function authedAction<S extends z.ZodType, T>(
  schema: S,
  handler: (input: z.infer<S>, session: SessionData) => Promise<ActionResult<T>>,
) {
  const action = async (_prev: unknown, raw: unknown): Promise<ActionResult<T>> => {
    const session = await getSession();
    if (!session) {
      logger('auth').warn({ result: 'unauthorized' }, 'Server action without session');
      return { ok: false, code: 'UNAUTHORIZED' };
    }
    const parsed = schema.safeParse(toInput(raw));
    if (!parsed.success) return invalid(parsed.error);
    return handler(parsed.data, session);
  };
  (action as Marked)[ACTION_KIND] = 'authed';
  return action;
}

/** For the few actions that must work without a session: sign-in steps. Input is still validated. */
export function publicAction<S extends z.ZodType, T>(
  schema: S,
  handler: (input: z.infer<S>) => Promise<ActionResult<T>>,
) {
  const action = async (_prev: unknown, raw: unknown): Promise<ActionResult<T>> => {
    const parsed = schema.safeParse(toInput(raw));
    if (!parsed.success) return invalid(parsed.error);
    return handler(parsed.data);
  };
  (action as Marked)[ACTION_KIND] = 'public';
  return action;
}

export function actionKind(fn: unknown): 'authed' | 'public' | undefined {
  return typeof fn === 'function' ? (fn as Marked)[ACTION_KIND] : undefined;
}
