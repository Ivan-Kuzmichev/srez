'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';
import { SIDEBAR_ITEMS, isActive } from './nav';

/** Left menu for wide screens (Main mockup). `footer` holds sync status and the user. */
export function Sidebar({ footer }: { footer?: ReactNode }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label={ru.nav.label}
      className="sticky top-0 hidden h-dvh w-[220px] shrink-0 flex-col justify-between gap-8 overflow-y-auto border-r border-border-subtle bg-bg-nav px-3.5 py-6 wide:flex"
    >
      <div className="flex flex-col gap-7">
        <div className="px-3">
          <Logo />
        </div>
        <div className="flex flex-col gap-1">
          {SIDEBAR_ITEMS.map((item) => {
            const active = isActive(item, pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-nav px-3 no-underline',
                  active
                    ? 'bg-surface-2 font-medium text-text hover:text-text'
                    : 'text-muted hover:text-text',
                )}
              >
                <span className={cn('flex', active && 'text-accent')}>
                  <Icon />
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
      {footer}
    </nav>
  );
}
