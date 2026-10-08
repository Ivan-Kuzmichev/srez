import { APP_NAME } from '@/lib/app';

/** The Srez mark: a circle with a pulled-out sector (design/logo.svg). */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="flex-none">
      <path d="M11 5a8 8 0 1 0 8 8h-8z" className="fill-accent" />
      <path d="M14 2.5V10h7.5A7.5 7.5 0 0 0 14 2.5z" className="fill-class-stocks" />
    </svg>
  );
}

/** Mark and name, used in the sidebar header and above the login card. */
export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-card font-semibold">{APP_NAME}</span>
    </div>
  );
}
