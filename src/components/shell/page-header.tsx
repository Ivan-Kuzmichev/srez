import Link from 'next/link';
import type { ReactNode } from 'react';
import { ru } from '@/lib/i18n/ru';

/**
 * Page title with actions on the right (28 px wide, 24 px on phones). Screens reached from «Ещё»
 * get a back arrow to it on phones (MSources, MSecurity).
 */
export function PageHeader({
  title,
  actions,
  backToMenu,
}: {
  title: ReactNode;
  actions?: ReactNode;
  backToMenu?: boolean;
}) {
  return (
    <header className="flex min-h-11 flex-wrap items-center justify-between gap-3 wide:mb-2 wide:gap-4">
      <div className="flex items-center gap-1">
        {backToMenu ? (
          <Link
            href="/more"
            aria-label={ru.settings.backToMenu}
            className="-ml-3 flex size-11 items-center justify-center text-text wide:hidden"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </Link>
        ) : null}
        <h1 className="m-0 text-page-phone font-semibold tracking-[-0.01em] wide:text-page">{title}</h1>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 wide:gap-3">{actions}</div> : null}
    </header>
  );
}
