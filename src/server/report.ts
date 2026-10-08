import { desc, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { finAccounts, jobs, logs, sources } from '@/db/schema';
import { serviceHealth, type Probes } from './health';
import { redact } from './redact';
import { getSettings } from './settings';

/**
 * «Собрать отчёт о проблеме» (FR-DEV-7): version, settings without secrets, sources and the queue,
 * the last 500 log lines. One JSON file, for a person or an assistant.
 */
export async function buildReport(db: Db, userId: string, probes?: Probes, now = new Date()) {
  const health = await serviceHealth(db, probes, now);
  const sourceRows = db
    .select({
      id: sources.id,
      kind: sources.kind,
      name: sources.name,
      status: sources.status,
      scheduleMinutes: sources.scheduleMinutes,
      lastSyncAt: sources.lastSyncAt,
      lastError: sources.lastError,
    })
    .from(sources)
    .where(eq(sources.userId, userId))
    .all();
  const accounts = db
    .select({
      id: finAccounts.id,
      sourceId: finAccounts.sourceId,
      name: finAccounts.name,
      kind: finAccounts.kind,
      syncEnabled: finAccounts.syncEnabled,
      closedAt: finAccounts.closedAt,
    })
    .from(finAccounts)
    .where(eq(finAccounts.userId, userId))
    .all();
  const failed = db
    .select({
      id: jobs.id,
      name: jobs.name,
      attempt: jobs.attempt,
      lastError: jobs.lastError,
      finishedAt: jobs.finishedAt,
    })
    .from(jobs)
    .where(eq(jobs.status, 'failed'))
    .orderBy(desc(jobs.id))
    .limit(20)
    .all()
    .map((j) => ({ ...j, jobId: `job_${j.id}` }));
  const lines = db
    .select()
    .from(logs)
    .orderBy(desc(logs.id))
    .limit(500)
    .all()
    .map((l) => ({
      ts: l.ts,
      level: l.level,
      source: l.source,
      message: l.message,
      requestId: l.requestId,
      jobId: l.jobId,
      context: redact(l.context),
    }));
  return {
    generatedAt: now.toISOString(),
    version: health.version,
    settings: getSettings(db, userId),
    health,
    sources: sourceRows.map((s) => ({ ...s, accounts: accounts.filter((a) => a.sourceId === s.id) })),
    failedJobs: failed,
    logs: lines,
  };
}
