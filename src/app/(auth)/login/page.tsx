import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginScreen } from '@/components/auth/login-screen';
import { ru } from '@/lib/i18n/ru';
import { getSession, safeNext } from '@/server/session';

export const metadata: Metadata = { title: ru.pages.login };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams;
  const next = safeNext(params.next);
  if (await getSession()) redirect(next);
  const notice = params.reason === 'second-factor' ? ru.auth.secondFactorReset : undefined;
  return <LoginScreen next={next} notice={notice} />;
}
