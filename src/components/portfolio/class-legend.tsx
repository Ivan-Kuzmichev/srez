import { ASSET_CLASS_COLOR } from '@/components/ui/allocation-bar';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';

const ORDER = ['stocks', 'bonds', 'funds', 'crypto', 'cash'] as const;

/** Class colors legend above portfolio cards (Portfolios mockup). */
export function ClassLegend() {
  return (
    <div className="flex flex-wrap gap-[18px] text-caption text-muted">
      {ORDER.map((c) => (
        <div key={c} className="flex items-center gap-2">
          <span className={cn('size-2.5 rounded-mark', ASSET_CLASS_COLOR[c])} />
          <span>{ru.classes[c]}</span>
        </div>
      ))}
    </div>
  );
}

/** Thin stacked bar of class shares (portfolio cards). */
export function ClassBar({
  shares,
  height = 'h-2.5',
}: {
  shares: { assetClass: string; share: number }[];
  height?: string;
}) {
  return (
    <span className={cn('flex gap-[3px]', height)} aria-hidden="true">
      {shares
        .filter((s) => s.share > 0)
        .map((s) => (
          <span
            key={s.assetClass}
            className={cn(
              'rounded-mark',
              ASSET_CLASS_COLOR[s.assetClass as keyof typeof ASSET_CLASS_COLOR] ?? 'bg-border-strong',
            )}
            style={{ flex: `${s.share} 1 0` }}
          />
        ))}
    </span>
  );
}
