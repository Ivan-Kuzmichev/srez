import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';
import { CLIENT_IP_HEADER, parseTrustedProxies, resolveClientIp } from '@/server/client-ip';
import { trustedProxyList } from '@/server/env';

let trusted: ReturnType<typeof parseTrustedProxies> | undefined;
const trustedList = () => (trusted ??= parseTrustedProxies(trustedProxyList().join(',')));

export const REQUEST_ID_HEADER = 'x-request-id';

/** Reachable without a session. Everything else needs one. */
// /api/v1 is authorized by its own bearer tokens (docs/06-api.md).
const PUBLIC_PREFIXES = ['/login', '/api/auth', '/api/health', '/api/v1', '/dev/ui'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Assigns a request id and sends visitors without a session cookie to the sign-in page.
 * This is only a shortcut: pages and server actions verify the session themselves.
 */
export function proxy(request: NextRequest) {
  const requestId = `req_${crypto.randomUUID()}`;
  const { pathname, search } = request.nextUrl;

  if (!isPublic(pathname) && !getSessionCookie(request, { cookiePrefix: 'srez' })) {
    // Server action POSTs carry their own check and answer with a refusal, not a redirect.
    if (request.method === 'GET' && !pathname.startsWith('/api/')) {
      const login = new URL('/login', request.url);
      if (pathname !== '/') login.searchParams.set('next', `${pathname}${search}`);
      const response = NextResponse.redirect(login);
      response.headers.set(REQUEST_ID_HEADER, requestId);
      return response;
    }
  }

  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  // The one client address every check uses (sign-in limits, API tokens); never what a client sent.
  headers.delete(CLIENT_IP_HEADER);
  const ip = resolveClientIp(request.headers, trustedList());
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
