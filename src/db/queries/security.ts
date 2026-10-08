import { and, desc, eq, gt } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { passkey, passkeyUsage, session } from '@/db/schema';

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

export interface SessionRow {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  loginMethod: string | null;
  updatedAt: Date;
}

/** Sessions that have not expired yet, most recently active first. */
export function listActiveSessions(db: Db, userId: string, now = new Date()): SessionRow[] {
  return db
    .select({
      id: session.id,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      loginMethod: session.loginMethod,
      updatedAt: session.updatedAt,
    })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, now)))
    .orderBy(desc(session.updatedAt))
    .all();
}
