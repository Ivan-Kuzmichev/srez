import type { SVGProps } from 'react';

/** Stroke icons from the mockups. Decorative: always aria-hidden. */
type IconProps = Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> & { size?: number; weight?: number };

function Stroke({ size = 18, weight = 1.8, children, ...props }: IconProps & { weight?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconOverview = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
  </Stroke>
);
export const IconPortfolios = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3v9h9" />
  </Stroke>
);
export const IconOperations = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </Stroke>
);
export const IconPayouts = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Stroke>
);
export const IconAnalytics = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M4 19V5M4 19h16M8 15l3-4 3 2 4-6" />
  </Stroke>
);
export const IconSources = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4" />
  </Stroke>
);
export const IconSettings = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </Stroke>
);
export const IconWallet = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M16 12.5h2M3 10h18" />
  </Stroke>
);
export const IconMore = ({ size = 20, ...p }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);
export const IconChevronDown = ({ size = 14, ...p }: IconProps) => (
  <Stroke size={size} weight={2} {...p}>
    <path d="M6 9l6 6 6-6" />
  </Stroke>
);
export const IconChevronRight = ({ size = 14, ...p }: IconProps) => (
  <Stroke size={size} weight={2} {...p}>
    <path d="M9 6l6 6-6 6" />
  </Stroke>
);
export const IconAlert = ({ size = 16, ...p }: IconProps) => (
  <Stroke size={size} weight={2} {...p}>
    <path d="M12 8v5M12 17h.01" />
    <circle cx="12" cy="12" r="9" />
  </Stroke>
);
export const IconCheck = ({ size = 16, ...p }: IconProps) => (
  <Stroke size={size} weight={2} {...p}>
    <path d="M5 12l5 5L20 7" />
  </Stroke>
);
export const IconClose = ({ size = 16, ...p }: IconProps) => (
  <Stroke size={size} weight={2} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Stroke>
);
export const IconKey = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l9-9M16 7l3 3M13.5 9.5l2 2" />
  </Stroke>
);
export const IconLock = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Stroke>
);
