import { Table, Td, Th } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { formatPlain } from '@/lib/format';
import { ru } from '@/lib/i18n/ru';
import { activity } from '@/lib/relative-date';
import type { SyncLogRow } from '@/server/sources';

const result = (r: SyncLogRow) =>
  r.status === 'ok'
    ? ru.sources.ok
    : r.status === 'running'
      ? ru.sources.running
      : ru.sources.failed(r.error ?? ru.shell.syncFailed);
const tone = (r: SyncLogRow) =>
  r.status === 'ok' ? 'text-gain' : r.status === 'error' ? 'text-loss' : 'text-text';

/** «Журнал синхронизации» (FR-SRC-3): a table on wide screens, a list on phones. */
export function SyncLog({
  rows,
  timeZone,
  debug = false,
}: {
  rows: SyncLogRow[];
  timeZone: string;
  debug?: boolean;
}) {
  return (
    <section
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
      data-testid="sync-log"
    >
      <h2 className="m-0 text-card font-semibold">{ru.sources.log}</h2>
      {rows.length === 0 ? (
        <div className="text-caption text-muted">{ru.sources.logEmpty}</div>
      ) : (
        <>
          <div className="hidden wide:block">
            <Table minWidth={640}>
              <thead>
                <tr>
                  <Th>{ru.sources.logColumns.time}</Th>
                  <Th>{ru.sources.logColumns.source}</Th>
                  <Th>{ru.sources.logColumns.result}</Th>
                  <Th align="right">{ru.sources.logColumns.added}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="[&:last-child>td]:border-b-0">
                    <Td mono className="text-caption text-muted">
                      {activity(r.startedAt, timeZone)}
                    </Td>
                    <Td>
                      {r.source}
                      {debug ? <span className="num text-small text-muted"> #{r.id}</span> : null}
                    </Td>
                    <Td className={tone(r)}>{result(r)}</Td>
                    <Td align="right" mono>
                      {formatPlain(r.newOperations, 0)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <ul className="m-0 flex list-none flex-col p-0 wide:hidden">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex min-h-[52px] items-center justify-between gap-3 border-b border-border-subtle py-1 last:border-b-0"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className={cn(tone(r))}>{result(r)}</span>
                  <span className="num text-small text-muted">{activity(r.startedAt, timeZone)}</span>
                </span>
                {r.status === 'ok' ? (
                  <span className="num text-caption text-muted whitespace-nowrap">
                    {ru.sources.added(r.newOperations)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
