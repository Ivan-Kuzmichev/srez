import type { ReactNode } from 'react';

/** Page title with actions on the right (28 px wide, 24 px on phones). */
export function PageHeader({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex min-h-11 flex-wrap items-center justify-between gap-3 wide:mb-2 wide:gap-4">
      <h1 className="m-0 text-page-phone font-semibold tracking-[-0.01em] wide:text-page">{title}</h1>
      {actions ? <div className="flex flex-wrap items-center gap-2 wide:gap-3">{actions}</div> : null}
    </header>
  );
}
