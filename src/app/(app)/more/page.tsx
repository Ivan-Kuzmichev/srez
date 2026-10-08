import type { Metadata } from 'next';
import Link from 'next/link';
import { IconChevronRight } from '@/components/icons';
import { PageHeader } from '@/components/shell/page-header';
import { SyncCard } from '@/components/shell/sync-card';
import { signOut } from '@/server/actions/auth';
import { requireSession } from '@/server/session';
import { ru } from '@/lib/i18n/ru';

export const metadata: Metadata = { title: ru.pages.more };

const groups = [
  {
    title: ru.more.analytics,
    links: [
      { href: '/analytics/risk', label: ru.pages.risk },
      { href: '/analytics/bonds', label: ru.pages.bonds },
      { href: '/analytics/realized', label: ru.pages.realized },
    ],
  },
  {
    title: ru.more.data,
    links: [
      { href: '/sources', label: ru.pages.sources },
      { href: '/portfolios', label: ru.more.portfoliosAndAccounts },
    ],
  },
  {
    title: ru.more.settings,
    links: [
      { href: '/settings', label: ru.pages.settingsGeneral },
      { href: '/settings/security', label: ru.pages.security },
      { href: '/settings/crypto', label: ru.pages.crypto },
      { href: '/settings/dev', label: ru.pages.dev },
      { href: '/settings/dev/logs', label: ru.pages.logs },
    ],
  },
];

/** Phone-only list of sections that do not fit the bottom bar (MMore mockup). */
export default async function MorePage() {
  const session = await requireSession();
  const username = session.user.displayUsername ?? session.user.username ?? session.user.name;
  const method = ru.more.loginMethod[String(session.session.loginMethod)];
  return (
    <>
      <PageHeader title={ru.pages.more} />
      <SyncCard summary={null} variant="card" />
      {groups.map((group) => (
        <section
          key={group.title}
          className="flex flex-col rounded-card border border-border bg-surface px-4 pt-3 pb-1"
        >
          <h2 className="m-0 pb-1 text-small font-medium text-muted">{group.title}</h2>
          {group.links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex min-h-[52px] items-center justify-between gap-3 border-b border-border-subtle text-text no-underline last:border-b-0 hover:text-text"
            >
              <span>{link.label}</span>
              <IconChevronRight size={16} className="text-muted" />
            </Link>
          ))}
        </section>
      ))}
      <section className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface px-4 py-1">
        <span className="flex flex-col gap-0.5 py-2.5">
          <span className="font-medium">{username}</span>
          {method ? <span className="text-small text-muted">{method}</span> : null}
        </span>
        <form
          action={async (form: FormData) => {
            'use server';
            await signOut(null, form);
          }}
        >
          <button
            type="submit"
            className="flex min-h-11 cursor-pointer items-center border-0 bg-transparent p-0 text-row text-loss"
          >
            {ru.nav.logout}
          </button>
        </form>
      </section>
    </>
  );
}
