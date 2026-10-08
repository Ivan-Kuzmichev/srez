import { createRequire } from 'node:module';
import pino, { type DestinationStream, type Logger } from 'pino';
import { db, type Db } from '@/db/client';
import { logs, type LogLevel } from '@/db/schema';
import { env } from './env';
import { redact } from './redact';

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

export interface LoggerOptions {
  level: LogLevel;
  getDb: () => Db;
  pretty?: boolean;
  /** Extra stream for tests; stdout otherwise. `false` writes to the database only (CLI). */
  console?: DestinationStream | false;
}

export function createLogger(options: LoggerOptions): { root: Logger; sink: DbLogSink } {
  const sink = new DbLogSink(options.getDb);
  const consoleStream =
    options.console === false
      ? null
      : (options.console ?? (options.pretty ? prettyStream() : pino.destination(1)));
  const root = pino(
    {
      level: options.level,
      base: undefined,
      formatters: {
        level: (label) => ({ level: pino.levels.values[label] ?? 30 }),
        bindings: (bindings) => redact(bindings) as Record<string, unknown>,
        log: (object) => redact(object) as Record<string, unknown>,
      },
      serializers: { err: pino.stdSerializers.err },
    },
    pino.multistream([
      ...(consoleStream ? [{ level: options.level, stream: consoleStream }] : []),
      { level: options.level, stream: sink },
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
  }
  return globalForLogger.srezLogger;
}

/** Logger for one source; add `requestId` or `jobId` with `.child()`. */
export function logger(source: LogSource, bindings: Record<string, unknown> = {}): Logger {
  return instance().root.child({ source, ...bindings });
}

/** Writes buffered rows now. Call before the process exits. */
export function flushLogs(): void {
  globalForLogger.srezLogger?.sink.flush();
}
