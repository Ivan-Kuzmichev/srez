import Link from 'next/link';
import type { ReactNode } from 'react';
import { TabLinks } from '@/components/ui/tab-links';
import { ru } from '@/lib/i18n/ru';

const TABS = [
  { href: '/settings', label: ru.pages.settingsGeneral },
  { href: '/settings/security', label: ru.pages.security },
  { href: '/settings/crypto', label: ru.pages.crypto },
  { href: '/settings/dev', label: ru.pages.dev },
];

/** «Настройки» with section tabs; on phones a back arrow to «Ещё» (MSecurity mockup). */
export function SettingsHeader({ actions }: { actions?: ReactNode }) {
  return (
    <>
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-3 wide:gap-4">
        <div className="flex items-center gap-1">
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
          <h1 className="m-0 text-page-phone font-semibold tracking-[-0.01em] wide:text-page">
            {ru.pages.settings}
          </h1>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </header>
      <div className="wide:mb-2">
        <TabLinks aria-label={ru.settings.tabsLabel} items={TABS} />
      </div>
    </>
  );
}
