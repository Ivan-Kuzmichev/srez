import type { ReactNode } from 'react';
import { BottomBar } from '@/components/shell/bottom-bar';
import { Sidebar } from '@/components/shell/sidebar';
import { SyncCard } from '@/components/shell/sync-card';

// Every page reads live user data; nothing here is cached.
export const dynamic = 'force-dynamic';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      {/* Sources and their sync status arrive in phase 4. */}
      <Sidebar footer={<SyncCard summary={null} />} />
      <main className="flex min-w-0 flex-1 flex-col gap-3 px-4 pt-4 pb-[calc(96px+env(safe-area-inset-bottom))] wide:gap-4 wide:p-8">
        {children}
      </main>
      <BottomBar />
    </div>
  );
}
