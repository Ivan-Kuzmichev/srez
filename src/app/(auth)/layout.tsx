import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';

/** Centered card with the mark above it (Login mockup). */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-[400px] flex-col gap-7">
        <div className="flex justify-center">
          <Logo />
        </div>
        {children}
      </div>
    </main>
  );
}
