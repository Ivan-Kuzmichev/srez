import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';

// Session checks on every request.
export const dynamic = 'force-dynamic';

/** Sign-in screens: the mark, then the card (Login mockup). */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-[400px] flex-col gap-7">
        <Logo />
        {children}
      </div>
    </main>
  );
}
