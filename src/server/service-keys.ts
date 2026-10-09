import { eq } from 'drizzle-orm';
import type { Executor } from '@/db/client';
import { serviceKeys } from '@/db/schema';
import { encryptSecret, type SecretPurpose } from './crypto';

export type ServiceKeyName = 'blockscout' | 'telegram';

/** The encryption purpose of each key: a blob of one cannot be read as another. */
export const keyPurpose = (name: ServiceKeyName): SecretPurpose =>
  name === 'telegram' ? 'telegram-token' : 'blockscout-key';

/** Stores a key encrypted; only its last four characters stay readable for the screen. */
export function setServiceKey(db: Executor, name: ServiceKeyName, plain: string, now = new Date()): void {
  const values = {
    secretEncrypted: encryptSecret(plain, keyPurpose(name)),
    last4: plain.slice(-4),
    updatedAt: now,
  };
  db.insert(serviceKeys)
    .values({ name, createdAt: now, ...values })
    .onConflictDoUpdate({ target: serviceKeys.name, set: values })
    .run();
}

export function removeServiceKey(db: Executor, name: ServiceKeyName): void {
  db.delete(serviceKeys).where(eq(serviceKeys.name, name)).run();
}

/** Whether a key is set, and its last four characters: never the key itself. */
export function serviceKeyInfo(
  db: Executor,
  name: ServiceKeyName,
): { last4: string; updatedAt: Date } | null {
  return (
    db
      .select({ last4: serviceKeys.last4, updatedAt: serviceKeys.updatedAt })
      .from(serviceKeys)
      .where(eq(serviceKeys.name, name))
      .get() ?? null
  );
}
