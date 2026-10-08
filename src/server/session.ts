import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from './auth';

export type SessionData = NonNullable<Awaited<ReturnType<ReturnType<typeof auth>['api']['getSession']>>>;

/**
 * Request headers with the cookie header rebuilt from `cookies()`. After a server action replaces the
 * session (2FA on or off), Next re-renders within the same request: `headers()` still holds the old
 * cookie, `cookies()` already has the new one.
 */
export async function requestHeaders(): Promise<Headers> {
  const result = new Headers(await headers());
  const jar = await cookies();
  result.set(
    'cookie',
    jar
      .getAll()
      .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
      .join('; '),
  );
  return result;
}

/** Current session from the request cookies, or null. */
export async function getSession(): Promise<SessionData | null> {
  return auth().api.getSession({ headers: await requestHeaders() });
}

/** For server components under (app): no session, no page. */
export async function requireSession(): Promise<SessionData> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

/** Only internal paths, so a crafted «next» cannot send the user to another site. */
export function safeNext(value: unknown): string {
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.startsWith('/\\')
    ? value
    : '/';
}
