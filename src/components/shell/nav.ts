import type { ComponentType } from 'react';
import {
  IconAnalytics,
  IconMore,
  IconOperations,
  IconOverview,
  IconPayouts,
  IconPortfolios,
  IconSettings,
  IconSources,
} from '@/components/icons';
import { ru } from '@/lib/i18n/ru';

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  /** Path prefixes that make this item active, besides `href` itself. */
  matches: readonly string[];
}

const overview: NavItem = { href: '/', label: ru.nav.overview, icon: IconOverview, matches: [] };
const portfolios: NavItem = {
  href: '/portfolios',
  label: ru.nav.portfolios,
  icon: IconPortfolios,
  matches: ['/portfolios', '/assets'],
};
const operations: NavItem = {
  href: '/operations',
  label: ru.nav.operations,
  icon: IconOperations,
  matches: ['/operations'],
};
const payouts: NavItem = {
  href: '/payouts',
  label: ru.nav.payouts,
  icon: IconPayouts,
  matches: ['/payouts'],
};
const analytics: NavItem = {
  href: '/analytics/risk',
  label: ru.nav.analytics,
  icon: IconAnalytics,
  matches: ['/analytics'],
};
const sources: NavItem = {
  href: '/sources',
  label: ru.nav.sources,
  icon: IconSources,
  matches: ['/sources'],
};
const settings: NavItem = {
  href: '/settings',
  label: ru.nav.settings,
  icon: IconSettings,
  matches: ['/settings'],
};

/** Sidebar from 900 px. */
export const SIDEBAR_ITEMS = [
  overview,
  portfolios,
  operations,
  payouts,
  analytics,
  sources,
  settings,
] as const;

/** Bottom bar below 900 px; everything else lives under «Ещё». */
export const BOTTOM_ITEMS = [
  overview,
  portfolios,
  operations,
  payouts,
  {
    href: '/more',
    label: ru.nav.more,
    icon: IconMore,
    matches: ['/more', '/analytics', '/sources', '/settings'],
  },
] as const satisfies readonly NavItem[];

export function isActive(item: NavItem, pathname: string): boolean {
  if (item.href === '/') return pathname === '/';
  return [item.href, ...item.matches].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
