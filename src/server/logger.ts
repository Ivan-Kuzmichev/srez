import { createRequire } from 'node:module';
import pino, { type DestinationStream, type Logger } from 'pino';
import { db, type Db } from '@/db/client';
import { logs, rawResponses, type LogLevel } from '@/db/schema';
import { onExternalRequest, type ExternalRequest } from '@/integrations/observe';
import { env } from './env';
import { logContext } from './log-context';
import { redact } from './redact';
import { debugActive, ownerSettings, type Settings } from './settings';

export type { Logger } from 'pino';

export const LOG_SOURCES = ['auth', 'api', 'collector', 'prices', 'jobs', 'chains', 'notify', 'web'] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

type LogRow = typeof logs.$inferInsert;

const PINO_LEVELS: Record<number, LogLevel> = {
  10: 'debug',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'error',
};
const OWN_FIELDS = new Set(['level', 'time', 'msg', 'pid', 'hostname', 'source', 'requestId', 'jobId']);

/** Turns one pino JSON line into a `logs` row. */
export function toLogRow(line: string): LogRow | null {
  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!OWN_FIELDS.has(key)) context[key] = value;
  }
  return {
    ts: new Date(typeof entry.time === 'number' ? entry.time : Date.now()),
    level: PINO_LEVELS[entry.level as number] ?? 'info',
    source: typeof entry.source === 'string' ? entry.source : 'web',
    message: typeof entry.msg === 'string' ? entry.msg : '',
    context: Object.keys(context).length > 0 ? context : null,
    requestId: typeof entry.requestId === 'string' ? entry.requestId : null,
    jobId: typeof entry.jobId === 'string' ? entry.jobId : null,
  };
}

/** Buffers log lines and writes them to the `logs` table in batches. */
export class DbLogSink implements DestinationStream {
  private buffer: LogRow[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly getDb: () => Db,
    private readonly options: { batchSize?: number; flushMs?: number } = {},
  ) {}

  write(line: string): void {
    const row = toLogRow(line);
    if (!row) return;
    this.buffer.push(row);
    if (this.buffer.length >= (this.options.batchSize ?? 100)) this.flush();
    else this.timer ??= setTimeout(() => this.flush(), this.options.flushMs ?? 1000).unref();
  }

  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.buffer.length === 0) return;
    const rows = this.buffer;
    this.buffer = [];
    try {
      this.getDb().insert(logs).values(rows).run();
    } catch (err) {
      // Never log through the logger here: a broken database would loop forever.
      process.stderr.write(`Failed to write ${rows.length} log rows: ${String(err)}\n`);
    }
  }
}

/** Runtime switches from «Разработка» (FR-DEV-2); refreshed from settings every minute. */
export interface LogConfig {
  /** The threshold; checked per call, because child loggers copy their level once at creation. */
  level: LogLevel;
  debug: boolean;
  maskAmounts: boolean;
  externalRequests: boolean;
  authEvents: boolean;
}
export const logConfig: LogConfig = {
  level: 'info',
  debug: false,
  maskAmounts: false,
  externalRequests: true,
  authEvents: true,
};

const MASK = '•••';
// Money and quantity fields, at any depth: amount, price, quantity, payment, balance, value…
const AMOUNT_KEY =
  /(amount|price|quantity|qty|payment|balance|value|total|sum|fee|tax|close|nominal|cost|cash|units|nano)$/i;
const NUMBER = /[-−+]?\d+(?:[\s\u00a0]\d{3})*(?:[.,]\d+)?/g;

/** «скрывать суммы и количества»: numbers in messages and amount-like fields become «•••». */
export function maskAmounts(value: unknown, key = ''): unknown {
  if (typeof value === 'number' || (typeof value === 'string' && AMOUNT_KEY.test(key)))
    return AMOUNT_KEY.test(key) ? MASK : value;
  if (Array.isArray(value)) return value.map((v) => maskAmounts(v, key));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = maskAmounts(v, k);
    return out;
  }
  return value;
}
export const maskMessage = (message: string) => message.replace(NUMBER, MASK);

export interface LoggerOptions {
  level: LogLevel;
  getDb: () => Db;
  pretty?: boolean;
  /** Extra stream for tests; stdout otherwise. `false` writes to the database only (CLI). */
  console?: DestinationStream | false;
}

export function createLogger(options: LoggerOptions): { root: Logger; sink: DbLogSink } {
  logConfig.level = options.level;
  const sink = new DbLogSink(options.getDb);
  const consoleStream =
    options.console === false
      ? null
      : (options.console ?? (options.pretty ? prettyStream() : pino.destination(1)));
  const root = pino(
    {
      level: 'debug',
      base: undefined,
      // jobId or requestId of the work in progress, unless the call sets its own.
      mixin: () => ({ ...logContext.getStore() }),
      formatters: {
        level: (label) => ({ level: pino.levels.values[label] ?? 30 }),
        bindings: (bindings) => redact(bindings) as Record<string, unknown>,
        log: (object) => {
          const clean = redact(object) as Record<string, unknown>;
          return logConfig.maskAmounts ? (maskAmounts(clean) as Record<string, unknown>) : clean;
        },
      },
      hooks: {
        logMethod(args, method, level) {
          if (level < (pino.levels.values[logConfig.level] ?? 30)) return;
          // «Писать входы и обращения по API-токену» off: routine entries go, warnings and errors stay.
          const source = (this.bindings() as { source?: string }).source;
          if (level < 40 && !logConfig.authEvents && (source === 'auth' || source === 'api')) return;
          if (logConfig.maskAmounts)
            args = args.map((a) => (typeof a === 'string' ? maskMessage(a) : a)) as typeof args;
          method.apply(this, args);
        },
      },
      serializers: { err: pino.stdSerializers.err },
    },
    // Streams take everything; the logger's own level decides, so it can change at runtime.
    pino.multistream([
      ...(consoleStream ? [{ level: 'debug' as const, stream: consoleStream }] : []),
      { level: 'debug' as const, stream: sink },
    ]),
  );
  return { root, sink };
}

function prettyStream(): DestinationStream {
  // Dev-only dependency, loaded lazily so production never requires it.
  const require = createRequire(import.meta.url);
  const pretty = require('pino-pretty') as (opts: object) => DestinationStream;
  return pretty({ colorize: true, sync: true, ignore: 'pid,hostname' });
}

const globalForLogger = globalThis as unknown as { srezLogger?: { root: Logger; sink: DbLogSink } };

function instance() {
  if (!globalForLogger.srezLogger) {
    const { LOG_LEVEL, NODE_ENV } = env();
    globalForLogger.srezLogger = createLogger({
      level: LOG_LEVEL,
      getDb: db,
      pretty: NODE_ENV !== 'production' && process.env.LOG_PRETTY !== '0',
      console: process.env.LOG_CONSOLE === '0' ? false : undefined,
    });
    refreshLogSettings();
    // Debug mode switches itself off on time; the other process (web or worker) may change settings.
    setInterval(refreshLogSettings, 60_000).unref();
    onExternalRequest(observeExternalRequest);
  }
  return globalForLogger.srezLogger;
}

/** Applies «Логирование» and «Режим отладки» from the owner's settings (FR-DEV-1, 2). */
export function applyLogSettings(s: Settings, now = Date.now()): void {
  logConfig.debug = debugActive(s, now);
  logConfig.level = logConfig.debug ? 'debug' : s.logging.level;
  logConfig.maskAmounts = s.logging.maskAmounts;
  logConfig.externalRequests = s.logging.externalRequests;
  logConfig.authEvents = s.logging.authEvents;
}

function refreshLogSettings(): void {
  try {
    applyLogSettings(ownerSettings(db()));
  } catch {
    // No database yet (first start, CLI): keep the environment level.
  }
}

const RAW_LIMIT = 256 * 1024;

/** One external call: a log line if asked for, and in debug mode the raw answer with secrets cut out. */
export function observeExternalRequest(r: ExternalRequest, database: () => Db = db): void {
  const source: LogSource = r.integration === 'tinvest' ? 'collector' : 'prices';
  if (logConfig.externalRequests) {
    const entry = {
      integration: r.integration,
      method: r.method,
      status: r.status,
      durationMs: r.durationMs,
      error: r.error,
    };
    const log = instance().root.child({ source });
    if (r.status === 0 || r.status >= 400)
      log.warn(
        entry,
        `${r.integration} ${r.method} failed: ${r.status || r.error || 'no answer'}, ${r.durationMs} ms`,
      );
    else log.info(entry, `${r.integration} ${r.method} ${r.status}, ${r.durationMs} ms`);
  }
  if (!logConfig.debug || r.body === undefined) return;
  let body: unknown = r.body.length > RAW_LIMIT ? `${r.body.slice(0, RAW_LIMIT)}…` : r.body;
  try {
    body = redact(JSON.parse(r.body));
  } catch {
    // Not JSON (or cut): kept as text.
  }
  try {
    database()
      .insert(rawResponses)
      .values({
        ts: new Date(),
        integration: r.integration,
        method: r.method,
        status: r.status,
        durationMs: r.durationMs,
        body,
      })
      .run();
  } catch (err) {
    process.stderr.write(`Failed to store a raw response: ${String(err)}\n`);
  }
}

/** Logger for one source; add `requestId` or `jobId` with `.child()`. */
export function logger(source: LogSource, bindings: Record<string, unknown> = {}): Logger {
  return instance().root.child({ source, ...bindings });
}

/** Writes buffered rows now. Call before the process exits. */
export function flushLogs(): void {
  globalForLogger.srezLogger?.sink.flush();
}
