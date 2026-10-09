'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabLink {
  href: string;
  label: ReactNode;
}

/** Section tabs that are real links, e.g. Риск · Облигации · Прибыль за год. */
export function TabLinks({
  items,
  'aria-label': ariaLabel,
}: {
  items: readonly TabLink[];
  'aria-label': string;
}) {
  const pathname = usePathname();
  return (
    // Phone: a scrollable row of pills edge to edge; wide: wrapped rounded tabs.
    <nav
      aria-label={ariaLabel}
      className="-mx-4 overflow-x-auto px-4 wide:mx-0 wide:overflow-visible wide:px-0"
    >
      <div className="flex w-max gap-2 wide:w-auto wide:flex-wrap">
        {items.map((item) => {
          const current = pathname === item.href.split('?')[0];
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'flex min-h-11 items-center rounded-pill border border-border px-3.5 text-row whitespace-nowrap no-underline wide:rounded-control wide:px-4',
                current ? 'bg-pressed font-medium text-text hover:text-text' : 'text-muted hover:text-text',
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
