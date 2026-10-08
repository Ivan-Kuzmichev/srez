import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from './auth';

export type SessionData = NonNullable<Awaited<ReturnType<ReturnType<typeof auth>['api']['getSession']>>>;

/** Current session from the request cookies, or null. */
export async function getSession(): Promise<SessionData | null> {
  return auth().api.getSession({ headers: await headers() });
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
