import Link from 'next/link';

/** Form screens: a breadcrumb on wide screens, a back arrow on phones (OperationForm, MOperationForm). */
export function FormHeader({
  title,
  parent,
  current,
  backLabel,
}: {
  title: string;
  parent: { href: string; label: string };
  current: string;
  backLabel: string;
}) {
  return (
    <header className="flex flex-col gap-3 wide:mb-2">
      <div className="hidden items-center gap-2 text-caption text-muted wide:flex">
        <Link href={parent.href} className="no-underline">
          {parent.label}
        </Link>
        <span>/</span>
        <span>{current}</span>
      </div>
      <div className="flex items-center gap-1">
        <Link
          href={parent.href}
          aria-label={backLabel}
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
        <h1 className="m-0 text-page-phone font-semibold tracking-[-0.01em] wide:text-page">{title}</h1>
      </div>
    </header>
  );
}
