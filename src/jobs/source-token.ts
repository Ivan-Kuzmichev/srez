import { eq } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { serviceKeys, sources } from '@/db/schema';
import { decryptSecret } from '@/server/secret-read';
import { keyPurpose, type ServiceKeyName } from '@/server/service-keys';

/** The plain T-Invest token of a source, for the next API call only; never stored or logged. */
export function tinvestToken(db: Executor, sourceId: string): string {
  const row = db
    .select({ blob: sources.secretEncrypted, kind: sources.kind })
    .from(sources)
    .where(eq(sources.id, sourceId))
    .get();
  if (!row || row.kind !== 'tinvest' || !row.blob)
    throw new Error(`Source ${sourceId} has no T-Invest token`);
  return decryptSecret(row.blob, 'tinvest-token');
}

/** A shared service key in plain text for the next call only (Blockscout); null when none is set. */
export function serviceKey(db: Executor, name: ServiceKeyName): string | null {
  const row = db
    .select({ blob: serviceKeys.secretEncrypted })
    .from(serviceKeys)
    .where(eq(serviceKeys.name, name))
    .get();
  return row ? decryptSecret(row.blob, keyPurpose(name)) : null;
}
