import Link from 'next/link';
import { ru } from '@/lib/i18n/ru';

const tile =
  'flex min-h-14 items-center justify-between gap-3 rounded-control border border-dashed border-border-strong px-3.5 py-2 text-left text-row text-text no-underline';

function Plus() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function Text({ title, text }: { title: string; text: string }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-medium">{title}</span>
      <span className="text-small text-muted">{text}</span>
    </span>
  );
}

/** «Что ещё можно подключить»: wallets come in a later phase; exchange and CSV are not planned yet. */
export function ConnectMore() {
  return (
    <section
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 wide:p-6"
      id="connect"
    >
      <h2 className="m-0 text-card font-semibold">{ru.sources.more}</h2>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className={`${tile} cursor-not-allowed opacity-60`}
          disabled
          title={ru.sources.soon}
        >
          <Text title={ru.sources.exchange} text={ru.sources.exchangeText} />
          <Plus />
        </button>
        <Link href="/sources/wallets/new" className={`${tile} hover:text-text`}>
          <Text title={ru.sources.wallet} text={ru.sources.walletText} />
          <Plus />
        </Link>
        <button
          type="button"
          className={`${tile} cursor-not-allowed opacity-60`}
          disabled
          title={ru.sources.soon}
        >
          <Text title={ru.sources.csv} text={ru.sources.csvText} />
          <Plus />
        </button>
      </div>
    </section>
  );
}
