import type { ReactNode } from 'react';
import { BottomBar } from '@/components/shell/bottom-bar';
import { Sidebar } from '@/components/shell/sidebar';
import { SyncCard } from '@/components/shell/sync-card';
import { UserRow } from '@/components/shell/user-row';
import { db } from '@/db/client';
import { requireSession } from '@/server/session';
import { getSettings } from '@/server/settings';
import { syncSummary } from '@/server/sources';

// Every page reads live user data; nothing here is cached.
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();
  const username = session.user.displayUsername ?? session.user.username ?? session.user.name;
  const summary = syncSummary(db(), session.user.id, getSettings(db(), session.user.id).display.timezone);
  return (
    <div className="flex min-h-dvh">
      <Sidebar
        footer={
          <SyncCard summary={summary}>
            <UserRow username={username} />
          </SyncCard>
        }
      />
      <main className="flex min-w-0 flex-1 flex-col gap-3 px-4 pt-4 pb-[calc(96px+env(safe-area-inset-bottom))] wide:gap-4 wide:p-8">
        {children}
      </main>
      <BottomBar />
    </div>
  );
}
