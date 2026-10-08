import { and, eq } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { sources } from '@/db/schema';
import { encryptSecret } from '@/server/crypto';

/** The T-Invest source of a user, with the token encrypted before it touches the database. */
export function createTinvestSource(
  db: Executor,
  userId: string,
  token: string,
  name = 'Т-Инвестиции',
): string {
  return db
    .insert(sources)
    .values({
      userId,
      kind: 'tinvest',
      name,
      secretEncrypted: encryptSecret(token, 'tinvest-token'),
      scheduleMinutes: 15,
    })
    .returning({ id: sources.id })
    .get().id;
}

/** «Заменить токен» (FR-SRC-2). Returns false for someone else's or a non-T-Invest source. */
export function replaceTinvestToken(db: Executor, userId: string, sourceId: string, token: string): boolean {
  const res = db
    .update(sources)
    .set({ secretEncrypted: encryptSecret(token, 'tinvest-token'), status: 'ok', lastError: null })
    .where(and(eq(sources.id, sourceId), eq(sources.userId, userId), eq(sources.kind, 'tinvest')))
    .run();
  return res.changes === 1;
}
