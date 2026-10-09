import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Db } from '@/db/client';

/**
 * FR-SET-6: a consistent copy of the database through SQLite's online backup, safe while web and
 * worker write. Signed-in sessions are cleared from the copy: the file must not let anyone in
 * without a password. Secrets inside stay encrypted with the app key.
 */
export async function backupDatabase(db: Db, destination: string): Promise<void> {
  mkdirSync(dirname(destination), { recursive: true });
  await db.$client.backup(destination);
  const copy = new Database(destination);
  try {
    copy.exec('DELETE FROM session; DELETE FROM verification;');
    copy.pragma('journal_mode = DELETE');
    copy.exec('VACUUM');
  } finally {
    copy.close();
  }
}

export function backupName(now = new Date()): string {
  return `srez-backup-${now.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.db`;
}
