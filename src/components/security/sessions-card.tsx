'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Pill } from '@/components/ui/pill';
import { Table, Td, Th } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { ru } from '@/lib/i18n/ru';
import { revokeOtherSessions, revokeSession } from '@/server/actions/security';

export interface SessionItem {
  id: string;
  device: string;
  method: string;
  ip: string;
  activity: string;
  current: boolean;
}

function EndButton({ item }: { item: SessionItem }) {
  const notify = useToast();
  return (
    <ConfirmDialog
      trigger={<Button variant="danger-text">{ru.security.end}</Button>}
      title={ru.security.endTitle(item.device)}
      confirmLabel={ru.security.end}
      danger
      onConfirm={async () => {
        const result = await revokeSession(null, { id: item.id });
        notify(
          result.ok
            ? { tone: 'success', title: ru.security.endDone }
            : { tone: 'error', title: ru.security.failedToast },
        );
      }}
    />
  );
}

function EndOthers({ className }: { className?: string }) {
  const notify = useToast();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="secondary-raised" className={className}>
          {ru.security.endOthers}
        </Button>
      }
      title={ru.security.endOthersTitle}
      description={ru.security.endOthersText}
      confirmLabel={ru.security.endOthers}
      danger
      onConfirm={async () => {
        const result = await revokeOtherSessions(null, {});
        notify(
          result.ok
            ? { tone: 'success', title: ru.security.endOthersDone }
            : { tone: 'error', title: ru.security.failedToast },
        );
      }}
    />
  );
}

const ThisDevice = () => (
  <Pill tone="accent" className="px-[9px] py-[3px]">
    {ru.security.thisDevice}
  </Pill>
);

/** Active sessions: a table on wide screens, a list on phones (Security, MSecurity mockups). */
export function SessionsCard({ sessions }: { sessions: SessionItem[] }) {
  const hasOthers = sessions.some((s) => !s.current);
  const logLink = (
    <Link
      href="/settings/dev/logs?source=auth"
      className="flex min-h-11 items-center text-caption no-underline"
    >
      {ru.security.loginLog}
    </Link>
  );

  return (
    <section
      className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4 wide:gap-3 wide:p-6"
      data-testid="sessions"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-card font-semibold">{ru.security.sessionsTitle}</h2>
        <div className="flex flex-wrap items-center gap-4">
          {logLink}
          {hasOthers ? (
            <span className="hidden wide:inline-flex">
              <EndOthers />
            </span>
          ) : null}
        </div>
      </div>

      <div className="hidden wide:block">
        <Table minWidth={640}>
          <thead>
            <tr>
              <Th>{ru.security.columns.device}</Th>
              <Th>{ru.security.columns.method}</Th>
              <Th>{ru.security.columns.ip}</Th>
              <Th>{ru.security.columns.activity}</Th>
              <Th align="right">{ru.security.columns.action}</Th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="[&:last-child>td]:border-b-0">
                <Td>
                  <span className="font-medium">{s.device}</span> {s.current ? <ThisDevice /> : null}
                </Td>
                <Td className="text-text-2">{s.method}</Td>
                <Td mono className="text-caption text-muted">
                  {s.ip}
                </Td>
                <Td className="text-text-2">{s.activity}</Td>
                <Td align="right" className={s.current ? 'text-muted' : undefined}>
                  {s.current ? ru.common.none : <EndButton item={s} />}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      <ul className="m-0 flex list-none flex-col p-0 wide:hidden">
        {sessions.map((s) => (
          <li
            key={s.id}
            className="flex min-h-16 items-center justify-between gap-3 border-b border-border-subtle last:border-b-0"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">{s.device}</span>
              <span className="text-small text-muted">{[s.method, s.ip, s.activity].join(' · ')}</span>
            </span>
            {s.current ? <ThisDevice /> : <EndButton item={s} />}
          </li>
        ))}
      </ul>
      {hasOthers ? <EndOthers className="mt-2 min-h-12 wide:hidden" /> : null}
    </section>
  );
}
