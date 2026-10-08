import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export const dynamic = 'force-dynamic';

export function GET() {
  try {
    db().get(sql`select 1`);
    return Response.json({ status: 'ok' });
  } catch {
    return Response.json({ status: 'error' }, { status: 503 });
  }
}
