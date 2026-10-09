import type { Metadata } from 'next';
import { PortfolioForm } from '@/components/portfolio/portfolio-form';
import { FormHeader } from '@/components/shell/form-header';
import { db } from '@/db/client';
import { ru } from '@/lib/i18n/ru';
import { benchmarkChoices } from '@/server/portfolio-page';
import { portfolioChoices, portfolioFormValues } from '@/server/portfolio-page';
import { requireSession } from '@/server/session';

export const metadata: Metadata = { title: ru.pages.portfolioNew };

export default async function NewPortfolioPage() {
  const session = await requireSession();
  const { accounts, tags } = portfolioChoices(db(), session.user.id);
  return (
    <>
      <FormHeader
        title={ru.portfolios.newTitle}
        parent={{ href: '/portfolios', label: ru.pages.portfolios }}
        current={ru.portfolios.newTitle}
        backLabel={ru.portfolios.back}
      />
      <PortfolioForm
        initial={portfolioFormValues(null, accounts)}
        accounts={accounts}
        tags={tags}
        benchmarks={benchmarkChoices(session.user.id)}
      />
    </>
  );
}
