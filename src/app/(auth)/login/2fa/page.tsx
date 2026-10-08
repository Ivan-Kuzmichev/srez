import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { TwoFactorScreen } from '@/components/auth/two-factor-screen';
import { ru } from '@/lib/i18n/ru';
import { safeNext } from '@/server/session';

export const metadata: Metadata = { title: ru.pages.twoFactor };

/** Reachable only between the password and the code: Better Auth's challenge cookie must be present. */
export default async function TwoFactorPage({ searchParams }: PageProps<'/login/2fa'>) {
  const jar = await cookies();
  if (!jar.get('srez.two_factor') && !jar.get('__Secure-srez.two_factor')) redirect('/login');
  const next = safeNext((await searchParams).next);
  return <TwoFactorScreen next={next} />;
}
