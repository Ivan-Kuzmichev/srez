import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/server/auth';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return toNextJsHandler(auth()).GET(request);
}

export function POST(request: Request) {
  return toNextJsHandler(auth()).POST(request);
}
