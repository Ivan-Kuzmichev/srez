import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { APP_NAME } from '@/lib/app';

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
