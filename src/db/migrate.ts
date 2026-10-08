import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { env } from '@/server/env';
import { openDb, type Db } from './client';

export function migrationsFolder(): string {
  // Repo root in development, /app in the image: both have ./drizzle next to the cwd.
  const folder = resolve(process.cwd(), 'drizzle');
  if (!existsSync(folder)) throw new Error(`Migrations folder not found: ${folder}`);
  return folder;
}

export function runMigrations(database: Db): void {
  migrate(database, { migrationsFolder: migrationsFolder() });
}

const isEntryPoint = process.argv[1] && /migrate\.(ts|mjs)$/.test(process.argv[1]);

if (isEntryPoint) {
  const path = env().DATABASE_PATH;
  const database = openDb(path);
  runMigrations(database);
  database.$client.close();
  console.log(`Migrations applied: ${path}`);
}
