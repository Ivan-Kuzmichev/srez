import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PortfolioForm } from '@/components/portfolio/portfolio-form';
import { FormHeader } from '@/components/shell/form-header';
import { db } from '@/db/client';
import { ru } from '@/lib/i18n/ru';
import { benchmarkChoices } from '@/server/portfolio-page';
import { listPortfolios } from '@/server/portfolio-data';
import { portfolioChoices, portfolioFormValues } from '@/server/portfolio-page';
import { requireSession } from '@/server/session';

export const metadata: Metadata = { title: ru.pages.portfolioEdit };

export default async function EditPortfolioPage({ params }: PageProps<'/portfolios/[id]/edit'>) {
  const session = await requireSession();
  const { id } = await params;
  const portfolio = listPortfolios(db(), session.user.id).find((p) => p.id === id);
  if (!portfolio) notFound();
  const { accounts, tags } = portfolioChoices(db(), session.user.id);
  return (
    <>
      <FormHeader
        title={ru.portfolios.editTitle}
        parent={{ href: `/portfolios/${id}`, label: portfolio.name }}
        current={ru.portfolios.breadcrumbEdit}
        backLabel={ru.portfolios.back}
      />
      <PortfolioForm
        id={id}
        initial={portfolioFormValues(portfolio, accounts)}
        accounts={accounts}
        tags={tags}
        benchmarks={benchmarkChoices(session.user.id)}
      />
    </>
  );
}
