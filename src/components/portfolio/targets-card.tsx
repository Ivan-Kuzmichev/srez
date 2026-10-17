'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { TargetBar, type TargetBarProps } from '@/components/ui/target-bar';
import { ru } from '@/lib/i18n/ru';

export type TargetRow = Omit<TargetBarProps, 'scaleMax'> & { key: string };

/**
 * «Цели и ребаланс» (FR-PRT-4, FR-PRT-10): classes or sectors, fact against target; a row's tooltip
 * says what reaches its target. Rows and figures come formatted from the server.
 */
export function TargetsCard({
  classes,
  sectors,
  classesEnabled,
  sectorTargets,
  rebalanceHref,
  editHref,
}: {
  classes: TargetRow[];
  sectors: TargetRow[];
  /** The portfolio has class targets; without them the classes view says so. */
  classesEnabled: boolean;
  /** The portfolio has at least one sector target. */
  sectorTargets: boolean;
  /** «Рассчитать ребаланс», or null on a past day's view. */
  rebalanceHref: string | null;
  editHref: string;
}) {
  const [view, setView] = useState<'classes' | 'sectors'>('classes');
  const t = ru.targetsCard;
  const rows = view === 'classes' ? classes : sectors;
  // A common scale for the view: the largest fact or target, at least half the width.
  const scaleMax = Math.max(50, ...rows.map((r) => Math.max(r.actual, r.target ?? 0) * 1.1));
  return (
    <section
      className="flex min-w-0 flex-[2_1_300px] flex-col gap-[18px] rounded-card border border-border bg-surface p-4 wide:p-6"
      data-testid="targets"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-card font-semibold">{ru.portfolio.targetsTitle}</h2>
        <Segmented
          aria-label={t.view}
          value={view}
          onValueChange={(v) => setView(v as 'classes' | 'sectors')}
          options={Object.entries(t.views).map(([value, label]) => ({ value, label }))}
        />
      </div>

      {view === 'classes' && !classesEnabled ? (
        <div className="text-caption text-muted">{ru.portfolio.noTargets}</div>
      ) : view === 'sectors' && rows.length === 0 ? (
        <div className="text-caption text-muted">{t.noSectors}</div>
      ) : (
        <>
          <div className="-mt-2 text-right text-small text-muted">
            {view === 'classes' ? t.hintClasses : t.hintSectors}
          </div>
          <div className="flex flex-col gap-3.5" data-testid={`targets-${view}`}>
            {rows.map(({ key, ...row }) => (
              <TargetBar key={key} {...row} scaleMax={scaleMax} />
            ))}
          </div>
        </>
      )}

      {view === 'sectors' && !sectorTargets && rows.length > 0 ? (
        <div className="text-caption text-pretty text-muted">{t.sectorsNoTargets}</div>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {view === 'classes' && classesEnabled && rebalanceHref ? (
          <Button asChild variant="secondary-raised">
            <Link href={rebalanceHref}>{ru.portfolio.rebalance}</Link>
          </Button>
        ) : (
          <Button asChild variant="secondary-raised">
            <Link href={editHref}>
              {(view === 'classes' ? classesEnabled : sectorTargets) ? t.editTargets : t.setTargets}
            </Link>
          </Button>
        )}
      </div>
    </section>
  );
}
