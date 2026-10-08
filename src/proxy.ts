import { NextResponse, type NextRequest } from 'next/server';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Gives every request an id that server code puts into its log records. */
export function proxy(request: NextRequest) {
  const requestId = `req_${crypto.randomUUID()}`;
  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
