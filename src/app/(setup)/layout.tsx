import type { ReactNode } from 'react';
import { requireSession } from '@/server/session';

export const dynamic = 'force-dynamic';

/** First-run wizard: signed-in, but without the app shell. */
export default async function SetupLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return children;
}
