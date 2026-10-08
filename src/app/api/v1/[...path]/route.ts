import { db } from '@/db/client';
import { dispatch } from '@/server/api/dispatch';

// Every call reads live data and is authorized by its own token.
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, { params }: Ctx) {
  return dispatch(db(), request, (await params).path);
}

export async function POST(request: Request, { params }: Ctx) {
  return dispatch(db(), request, (await params).path);
}
