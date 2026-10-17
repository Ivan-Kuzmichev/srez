'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { ru } from '@/lib/i18n/ru';
import { setInstrumentSector } from '@/server/actions/instruments';

/** «Отрасль» on an asset (FR-PRT-10): the broker's by default, or the owner's choice. */
export function SectorPicker({
  instrumentId,
  sector,
  manual,
}: {
  instrumentId: string;
  sector: string | null;
  manual: boolean;
}) {
  const router = useRouter();
  const notify = useToast();
  const [pending, start] = useTransition();
  const t = ru.asset;
  const broker = !manual ? (sector ? (ru.sectors[sector] ?? sector) : ru.sectors['']!) : null;
  const options = [
    { value: 'auto', label: t.sectorAuto(broker) },
    ...Object.entries(ru.sectors)
      .filter(([code]) => code !== '')
      .map(([value, label]) => ({ value, label })),
  ];
  return (
    <div className="w-full max-w-72">
      <Select
        aria-label={t.sector}
        disabled={pending}
        value={manual && sector ? sector : 'auto'}
        onValueChange={(v) =>
          start(async () => {
            const r = await setInstrumentSector(null, { instrumentId, sector: v });
            notify(
              r.ok ? { tone: 'success', title: t.sectorSaved } : { tone: 'error', title: t.sectorFailed },
            );
            router.refresh();
          })
        }
        options={options}
      />
    </div>
  );
}
