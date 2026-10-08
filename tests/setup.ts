// The process-wide in-memory database (DATABASE_PATH=:memory:) gets the schema, so the global logger can write.
import { db } from '@/db/client';
import { runMigrations } from '@/db/migrate';

runMigrations(db());
