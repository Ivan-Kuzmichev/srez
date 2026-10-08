import { desc, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { passkey, passkeyUsage } from '@/db/schema';

export interface PasskeyRow {
  id: string;
  name: string | null;
  createdAt: Date | null;
  lastUsedAt: Date | null;
}

export function listPasskeys(db: Db, userId: string): PasskeyRow[] {
  return db
    .select({
      id: passkey.id,
      name: passkey.name,
      createdAt: passkey.createdAt,
      lastUsedAt: passkeyUsage.lastUsedAt,
    })
    .from(passkey)
    .leftJoin(passkeyUsage, eq(passkeyUsage.passkeyId, passkey.id))
    .where(eq(passkey.userId, userId))
    .orderBy(desc(passkey.createdAt))
    .all();
}
