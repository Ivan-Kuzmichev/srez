'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

export interface TabLink {
  href: string;
  label: string;
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
    <nav aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {items.map((item) => {
        const current = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'flex min-h-11 items-center rounded-control border border-border px-4 text-row no-underline',
              current ? 'bg-pressed font-medium text-text hover:text-text' : 'text-muted hover:text-text',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
