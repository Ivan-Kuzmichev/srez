import type { Metadata } from 'next';
import { Showcase } from './showcase';

export const metadata: Metadata = { title: 'UI', robots: { index: false } };

/** Component showcase for phase 0. Remove before release (phase 10). */
export default function DevUiPage() {
  return <Showcase />;
}
