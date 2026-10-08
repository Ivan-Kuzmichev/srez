import { and, asc, desc, eq, gte, inArray, lt, lte, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { listLogs } from '@/db/queries/logs';
import {
  discrepancies,
  finAccounts,
  instruments,
  jobs,
  operations,
  OPERATION_ORIGINS,
  OPERATION_TYPES,
  payoutEvents,
  pricesLast,
  sources,
  syncRuns,
  type LogLevel,
} from '@/db/schema';
import { Decimal } from '@/domain/decimal';
import { everything } from '@/domain/scope';
import { enqueue } from '@/jobs/queue';
import { RECALC_JOB } from '@/jobs/positions';
import { enqueueSync, SYNC_JOB } from '@/jobs/tinvest-sync';
import { serviceHealth } from '../health';
import { buildReport } from '../report';
import { getSettings } from '../settings';
import {
  listPortfolios,
  loadFx,
  loadUserLedger,
  loadValuedCells,
  portfolioScope,
  summarizeArea,
  type ValuedCell,
} from '../portfolio-data';
import { ApiError, endpoint, notFound, type Endpoint } from './core';

const Limit = z.coerce.number().int().min(1).max(500).default(100);
const Cursor = z.string().max(100).optional();
const IsoDate = z.iso.datetime({ offset: true }).or(z.iso.date());
const at = (v: string | undefined) => (v ? new Date(v.length === 10 ? `${v}T00:00:00Z` : v) : undefined);

/** «[createdAt]|[id]» keeps paging stable when rows share a time. */
const encode = (t: Date, id: string | number) => `${t.getTime()}_${id}`;
function decode(cursor: string | undefined): { t: Date; id: string } | null {
  if (!cursor) return null;
  const m = /^(\d+)_(.+)$/.exec(cursor);
  if (!m) throw new ApiError(400, 'BAD_CURSOR', 'Cursor is not one this API gave out');
  return { t: new Date(Number(m[1])), id: m[2]! };
}

const cellJson = (c: ValuedCell) => ({
  accountId: c.accountId,
  instrumentId: c.instrumentId,
  tagId: c.tagId,
  ticker: c.ticker,
  name: c.name,
  kind: c.kind,
  assetClass: c.assetClass,
  currency: c.currency,
  quantity: c.quantity,
  priceRub: c.priceRub,
  valueRub: c.valueRub,
  avgPriceRub: c.avgPriceRub,
  costRub: c.costRub,
  approx: c.approx,
});

function area(ctx: { db: Parameters<typeof loadFx>[0]; userId: string }) {
  const fx = loadFx(ctx.db);
  return {
    fx,
    cells: loadValuedCells(ctx.db, ctx.userId, fx),
    ledger: loadUserLedger(ctx.db, ctx.userId),
    tz: getSettings(ctx.db, ctx.userId).display.timezone,
  };
}

function summary(s: ReturnType<typeof summarizeArea>) {
  return {
    valueRub: s.value,
    investedRub: s.invested,
    profitRub: s.profit,
    profitPct: s.profitPct,
    dayChangeRub: s.dayChange,
    dayChangePct: s.dayChangePct,
    approx: s.approx,
  };
}

function ownSource(ctx: { db: Parameters<typeof loadFx>[0]; userId: string }, sourceId: string) {
  const s = ctx.db
    .select()
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.userId, ctx.userId)))
    .get();
  if (!s) throw notFound('Source');
  return s;
}

/** The job waiting for this key, so a repeated call reports the same id. */
function queuedJob(db: Parameters<typeof loadFx>[0], key: string): number | null {
  return (
    db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.singletonKey, key), inArray(jobs.status, ['queued', 'running'])))
      .orderBy(desc(jobs.id))
      .get()?.id ?? null
  );
}

// Each endpoint has its own query and body types; the dispatcher hands them input its schemas checked.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const endpoints: Endpoint<any, any>[] = [
  // Data, read:data.
  endpoint({
    method: 'GET',
    path: '/portfolios',
    scope: 'read:data',
    summary: 'Portfolios with value, invested and profit (rubles)',
    handler(ctx) {
      const a = area(ctx);
      return {
        all: summary(summarizeArea(ctx.db, ctx.userId, everything, a.cells, a.ledger, a.fx, a.tz, null)),
        portfolios: listPortfolios(ctx.db, ctx.userId).map((p) => ({
          id: p.id,
          name: p.name,
          ...summary(
            summarizeArea(ctx.db, ctx.userId, portfolioScope(p), a.cells, a.ledger, a.fx, a.tz, null),
          ),
        })),
      };
    },
  }),
  endpoint({
    method: 'GET',
    path: '/portfolios/{id}',
    scope: 'read:data',
    summary: 'One portfolio: value, returns, structure against targets, positions',
    handler(ctx) {
      const p = listPortfolios(ctx.db, ctx.userId).find((x) => x.id === ctx.params.id);
      if (!p) throw notFound('Portfolio');
      const a = area(ctx);
      const s = summarizeArea(ctx.db, ctx.userId, portfolioScope(p), a.cells, a.ledger, a.fx, a.tz, {
        values: p.targetsEnabled ? p.targets : new Map(),
        threshold: p.deviationThreshold,
      });
      return {
        id: p.id,
        name: p.name,
        rules: p.rules,
        ...summary(s),
        structure: s.classes.map((c) => ({
          assetClass: c.assetClass,
          valueRub: c.value,
          sharePct: c.share,
          targetPct: c.target,
          offTarget: c.offTarget,
        })),
        positions: s.cells.map(cellJson),
      };
    },
  }),
  endpoint({
    method: 'GET',
    path: '/accounts',
    scope: 'read:data',
    summary: 'Accounts and their sources',
    handler(ctx) {
      return {
        accounts: ctx.db
          .select({
            id: finAccounts.id,
            name: finAccounts.name,
            kind: finAccounts.kind,
            currency: finAccounts.currency,
            syncEnabled: finAccounts.syncEnabled,
            openedAt: finAccounts.openedAt,
            closedAt: finAccounts.closedAt,
            sourceId: sources.id,
            sourceKind: sources.kind,
            sourceName: sources.name,
          })
          .from(finAccounts)
          .innerJoin(sources, eq(sources.id, finAccounts.sourceId))
          .where(eq(finAccounts.userId, ctx.userId))
          .all(),
      };
    },
  }),
  endpoint({
    method: 'GET',
    path: '/positions',
    scope: 'read:data',
    summary: 'Positions now, valued in rubles; by account or portfolio',
    query: z.object({ accountId: z.string().optional(), portfolioId: z.string().optional() }),
    handler(ctx) {
      const a = area(ctx);
      let cells = a.cells;
      if (ctx.query.portfolioId) {
        const p = listPortfolios(ctx.db, ctx.userId).find((x) => x.id === ctx.query.portfolioId);
        if (!p) throw notFound('Portfolio');
        const scope = portfolioScope(p);
        cells = cells.filter((c) => scope(c.accountId, c.tagId));
      }
      if (ctx.query.accountId) cells = cells.filter((c) => c.accountId === ctx.query.accountId);
      return { positions: cells.map(cellJson) };
    },
  }),
  endpoint({
    method: 'GET',
    path: '/operations',
    scope: 'read:data',
    summary: 'The journal, newest first',
    query: z.object({
      accountId: z.string().optional(),
      instrumentId: z.string().optional(),
      type: z.enum(OPERATION_TYPES).optional(),
      origin: z.enum(OPERATION_ORIGINS).optional(),
      from: IsoDate.optional(),
      to: IsoDate.optional(),
      limit: Limit,
      cursor: Cursor,
    }),
    handler(ctx) {
      const q = ctx.query;
      const parts: SQL[] = [eq(operations.userId, ctx.userId)];
      if (q.accountId) parts.push(eq(operations.accountId, q.accountId));
      if (q.instrumentId) parts.push(eq(operations.instrumentId, q.instrumentId));
      if (q.type) parts.push(eq(operations.type, q.type));
      if (q.origin) parts.push(eq(operations.origin, q.origin));
      if (q.from) parts.push(gte(operations.executedAt, at(q.from)!));
      if (q.to) parts.push(lte(operations.executedAt, at(q.to)!));
      const c = decode(q.cursor);
      if (c)
        parts.push(
          or(lt(operations.executedAt, c.t), and(eq(operations.executedAt, c.t), lt(operations.id, c.id)))!,
        );
      const rows = ctx.db
        .select({
          id: operations.id,
          accountId: operations.accountId,
          instrumentId: operations.instrumentId,
          ticker: instruments.ticker,
          instrumentName: instruments.name,
          type: operations.type,
          executedAt: operations.executedAt,
          quantity: operations.quantity,
          price: operations.price,
          currency: operations.currency,
          amount: operations.amount,
          fee: operations.fee,
          tax: operations.tax,
          accruedInterest: operations.accruedInterest,
          tagId: operations.tagId,
          note: operations.note,
          origin: operations.origin,
          sourceId: operations.sourceId,
          externalId: operations.externalId,
        })
        .from(operations)
        .leftJoin(instruments, eq(instruments.id, operations.instrumentId))
        .where(and(...parts))
        .orderBy(desc(operations.executedAt), desc(operations.id))
        .limit(q.limit + 1)
        .all();
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return {
        operations: page,
        nextCursor: rows.length > q.limit && last ? encode(last.executedAt, last.id) : null,
      };
    },
  }),
  endpoint({
    method: 'GET',
    path: '/instruments/{id}',
    scope: 'read:data',
    summary: 'An instrument and its last price',
    handler(ctx) {
      const i = ctx.db.select().from(instruments).where(eq(instruments.id, ctx.params.id!)).get();
      if (!i || (i.userId !== null && i.userId !== ctx.userId)) throw notFound('Instrument');
      const price = ctx.db.select().from(pricesLast).where(eq(pricesLast.instrumentId, i.id)).get() ?? null;
      const { userId: _owner, ...rest } = i;
      return {
        instrument: rest,
        lastPrice: price && {
          price: price.price,
          currency: price.currency,
          at: price.at,
          source: price.source,
        },
      };
    },
  }),
  endpoint({
    method: 'GET',
    path: '/payouts',
    scope: 'read:data',
    summary: 'Payouts received in a year and the ones scheduled for what is held now',
    query: z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }),
    handler(ctx) {
      const year = ctx.query.year ?? ctx.now.getUTCFullYear();
      const from = new Date(Date.UTC(year, 0, 1));
      const to = new Date(Date.UTC(year + 1, 0, 1));
      const received = ctx.db
        .select({
          id: operations.id,
          accountId: operations.accountId,
          instrumentId: operations.instrumentId,
          name: instruments.name,
          type: operations.type,
          executedAt: operations.executedAt,
          amount: operations.amount,
          tax: operations.tax,
          currency: operations.currency,
        })
        .from(operations)
        .leftJoin(instruments, eq(instruments.id, operations.instrumentId))
        .where(
          and(
            eq(operations.userId, ctx.userId),
            inArray(operations.type, ['dividend', 'coupon', 'interest', 'amortization', 'redemption']),
            gte(operations.executedAt, from),
            lt(operations.executedAt, to),
          ),
        )
        .orderBy(asc(operations.executedAt))
        .all();
      const a = area(ctx);
      const held = new Map<string, Decimal>();
      for (const c of a.cells)
        if (!c.isCash && c.quantity.gt(0))
          held.set(c.instrumentId, (held.get(c.instrumentId) ?? new Decimal(0)).plus(c.quantity));
      const expected = held.size
        ? ctx.db
            .select({ e: payoutEvents, name: instruments.name })
            .from(payoutEvents)
            .innerJoin(instruments, eq(instruments.id, payoutEvents.instrumentId))
            .where(
              and(
                inArray(payoutEvents.instrumentId, [...held.keys()]),
                gte(payoutEvents.payDate, `${year}-01-01`),
                lt(payoutEvents.payDate, `${year + 1}-01-01`),
              ),
            )
            .orderBy(asc(payoutEvents.payDate))
            .all()
            .map(({ e, name }) => ({
              instrumentId: e.instrumentId,
              name,
              kind: e.kind,
              recordDate: e.recordDate,
              payDate: e.payDate,
              amountPerUnit: e.amountPerUnit,
              quantity: held.get(e.instrumentId)!,
              amount: new Decimal(e.amountPerUnit).times(held.get(e.instrumentId)!),
              currency: e.currency,
              estimate: e.isEstimate,
            }))
        : [];
      return { year, received, expected };
    },
  }),
  endpoint({
    method: 'GET',
    path: '/reconciliation',
    scope: 'read:data',
    summary: 'Open and snoozed discrepancies between the journal and the broker',
    handler(ctx) {
      return {
        discrepancies: ctx.db
          .select({
            id: discrepancies.id,
            accountId: discrepancies.accountId,
            accountName: finAccounts.name,
            instrumentId: discrepancies.instrumentId,
            ticker: instruments.ticker,
            name: instruments.name,
            ledgerQty: discrepancies.ledgerQty,
            brokerQty: discrepancies.brokerQty,
            guess: discrepancies.guess,
            status: discrepancies.status,
            detectedAt: discrepancies.detectedAt,
          })
          .from(discrepancies)
          .innerJoin(finAccounts, eq(finAccounts.id, discrepancies.accountId))
          .innerJoin(instruments, eq(instruments.id, discrepancies.instrumentId))
          .where(and(eq(finAccounts.userId, ctx.userId), inArray(discrepancies.status, ['open', 'snoozed'])))
          .orderBy(asc(discrepancies.detectedAt))
          .all(),
      };
    },
  }),

  // Diagnostics, read:logs.
  endpoint({
    method: 'GET',
    path: '/health',
    scope: 'read:logs',
    summary: 'Database, queue, external APIs with their delay, errors in a day, version',
    handler: (ctx) => serviceHealth(ctx.db),
  }),
  endpoint({
    method: 'GET',
    path: '/sync/status',
    scope: 'read:logs',
    summary: 'Sources with the time and result of the last sync',
    handler(ctx) {
      const list = ctx.db
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
        .where(eq(sources.userId, ctx.userId))
        .all();
      return {
        sources: list.map((s) => ({
          ...s,
          lastRun:
            ctx.db
              .select()
              .from(syncRuns)
              .where(eq(syncRuns.sourceId, s.id))
              .orderBy(desc(syncRuns.id))
              .get() ?? null,
          queuedJobId: s.kind === 'tinvest' ? queuedJob(ctx.db, `${SYNC_JOB}:${s.id}`) : null,
        })),
      };
    },
  }),
  endpoint({
    method: 'GET',
    path: '/sync/runs',
    scope: 'read:logs',
    summary: 'The sync log, newest first',
    query: z.object({ sourceId: z.string().optional(), limit: Limit, cursor: Cursor }),
    handler(ctx) {
      const own = ctx.db
        .select({ id: sources.id })
        .from(sources)
        .where(eq(sources.userId, ctx.userId))
        .all()
        .map((s) => s.id);
      const ids = ctx.query.sourceId ? own.filter((id) => id === ctx.query.sourceId) : own;
      if (ids.length === 0) return { runs: [], nextCursor: null };
      const before = ctx.query.cursor ? Number(ctx.query.cursor) : null;
      if (ctx.query.cursor && !Number.isInteger(before))
        throw new ApiError(400, 'BAD_CURSOR', 'Cursor is not one this API gave out');
      const rows = ctx.db
        .select()
        .from(syncRuns)
        .where(and(inArray(syncRuns.sourceId, ids), before ? lt(syncRuns.id, before) : undefined))
        .orderBy(desc(syncRuns.id))
        .limit(ctx.query.limit + 1)
        .all();
      const page = rows.slice(0, ctx.query.limit);
      return { runs: page, nextCursor: rows.length > ctx.query.limit ? String(page.at(-1)!.id) : null };
    },
  }),
  endpoint({
    method: 'GET',
    path: '/logs',
    scope: 'read:logs',
    summary: 'Logs, newest first; level means this level and above',
    query: z.object({
      level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
      source: z.string().max(20).optional(),
      from: IsoDate.optional(),
      to: IsoDate.optional(),
      q: z.string().max(200).optional(),
      requestId: z.string().max(100).optional(),
      jobId: z.string().max(100).optional(),
      limit: Limit,
      cursor: Cursor,
    }),
    handler(ctx) {
      const q = ctx.query;
      const before = q.cursor ? Number(q.cursor) : undefined;
      if (q.cursor && !Number.isInteger(before))
        throw new ApiError(400, 'BAD_CURSOR', 'Cursor is not one this API gave out');
      const { rows, total, nextCursor } = listLogs(
        ctx.db,
        {
          minLevel: q.level as LogLevel | undefined,
          source: q.source,
          from: at(q.from),
          to: at(q.to),
          q: q.q,
          requestId: q.requestId,
          jobId: q.jobId,
        },
        q.limit,
        before,
      );
      return { logs: rows, total, nextCursor: nextCursor === null ? null : String(nextCursor) };
    },
  }),
  endpoint({
    method: 'GET',
    path: '/jobs',
    scope: 'read:logs',
    summary: 'Jobs in the queue and the failed ones; their log records are found by jobId «job_<id>»',
    query: z.object({
      state: z.enum(['queued', 'running', 'done', 'failed']).optional(),
      limit: Limit,
      cursor: Cursor,
    }),
    handler(ctx) {
      const before = ctx.query.cursor ? Number(ctx.query.cursor) : null;
      if (ctx.query.cursor && !Number.isInteger(before))
        throw new ApiError(400, 'BAD_CURSOR', 'Cursor is not one this API gave out');
      const rows = ctx.db
        .select()
        .from(jobs)
        .where(
          and(
            ctx.query.state
              ? eq(jobs.status, ctx.query.state)
              : inArray(jobs.status, ['queued', 'running', 'failed']),
            before ? lt(jobs.id, before) : undefined,
          ),
        )
        .orderBy(desc(jobs.id))
        .limit(ctx.query.limit + 1)
        .all()
        .map((j) => ({ ...j, jobId: `job_${j.id}` }));
      const page = rows.slice(0, ctx.query.limit);
      return { jobs: page, nextCursor: rows.length > ctx.query.limit ? String(page.at(-1)!.id) : null };
    },
  }),
  endpoint({
    method: 'GET',
    path: '/diagnostics/report',
    scope: 'read:logs',
    summary: 'Problem report: version, settings without secrets, sources, queue, last 500 log lines',
    handler: (ctx) => buildReport(ctx.db, ctx.userId),
  }),

  // Actions, run:sync.
  endpoint({
    method: 'POST',
    path: '/sync/run',
    scope: 'run:sync',
    summary: 'Queue a sync of a source; returns the job id',
    body: z.object({ sourceId: z.string().min(1) }),
    handler(ctx) {
      const s = ownSource(ctx, ctx.body.sourceId);
      if (s.kind !== 'tinvest') throw new ApiError(400, 'NOT_SYNCABLE', 'Only T-Invest sources sync');
      enqueueSync(ctx.db, s.id, 'api');
      return { jobId: `job_${queuedJob(ctx.db, `${SYNC_JOB}:${s.id}`)}` };
    },
  }),
  endpoint({
    method: 'POST',
    path: '/reconciliation/run',
    scope: 'run:sync',
    summary: 'Queue a reconciliation; it runs at the end of a sync, so this queues one; returns the job id',
    body: z.object({ sourceId: z.string().min(1) }),
    handler(ctx) {
      const s = ownSource(ctx, ctx.body.sourceId);
      if (s.kind !== 'tinvest') throw new ApiError(400, 'NOT_SYNCABLE', 'Only T-Invest sources reconcile');
      enqueueSync(ctx.db, s.id, 'api');
      return { jobId: `job_${queuedJob(ctx.db, `${SYNC_JOB}:${s.id}`)}` };
    },
  }),
  endpoint({
    method: 'POST',
    path: '/positions/recalc',
    scope: 'run:sync',
    summary: 'Queue a recalculation of an account; returns the job id',
    body: z.object({ accountId: z.string().min(1) }),
    handler(ctx) {
      const a = ctx.db
        .select({ id: finAccounts.id })
        .from(finAccounts)
        .where(and(eq(finAccounts.id, ctx.body.accountId), eq(finAccounts.userId, ctx.userId)))
        .get();
      if (!a) throw notFound('Account');
      const key = `${RECALC_JOB}:${a.id}`;
      const id =
        enqueue(ctx.db, RECALC_JOB, { accountId: a.id }, { singletonKey: key }) ?? queuedJob(ctx.db, key);
      return { jobId: `job_${id}` };
    },
  }),
];
