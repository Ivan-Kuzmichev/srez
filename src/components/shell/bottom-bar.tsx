'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';
import { BOTTOM_ITEMS, isActive } from './nav';

/** Tab bar for phones (MMain mockup), pinned to the bottom with the safe area. */
export function BottomBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label={ru.nav.label}
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border-subtle bg-bg-nav px-1 pt-1.5 pb-[max(12px,env(safe-area-inset-bottom))] wide:hidden"
    >
      {BOTTOM_ITEMS.map((item) => {
        const active = isActive(item, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-12 flex-col items-center justify-center gap-1 text-small no-underline',
              active ? 'font-medium text-text hover:text-text' : 'text-muted hover:text-text',
            )}
          >
            <span className={cn('flex', active && 'text-accent')}>
              <Icon size={20} />
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
