'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/choice';
import { useToast } from '@/components/ui/toast';
import { ru } from '@/lib/i18n/ru';

/** Fresh backup codes, shown once (SecurityOn mockup, first card). */
export function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const notify = useToast();
  const text = codes.join('\n');

  function download() {
    const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = ru.security.codesFileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="flex max-w-[760px] flex-col gap-5 rounded-card border border-border bg-surface p-4 wide:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-[18px] font-semibold">{ru.security.twoFactorTitle}</h2>
        <EnabledPill />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="m-0 text-body font-semibold">{ru.security.codesTitle}</h3>
        <div className="text-pretty text-row text-muted">{ru.security.codesText}</div>
      </div>
      <div
        data-testid="backup-codes"
        className="num grid grid-cols-[repeat(auto-fit,minmax(min(130px,100%),1fr))] gap-2 rounded-control border border-border bg-bg p-4 text-body tracking-[0.04em]"
      >
        {codes.map((code) => (
          <span key={code}>{code}</span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary-raised" onClick={download}>
          {ru.security.download}
        </Button>
        <Button
          variant="secondary-raised"
          onClick={() =>
            void navigator.clipboard
              .writeText(text)
              .then(() => notify({ tone: 'success', title: ru.security.copied }))
          }
        >
          {ru.security.copy}
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-[18px]">
        <Checkbox
          label={ru.security.codesSaved}
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
        />
        <Button variant="primary" disabled={!saved} onClick={onDone}>
          {ru.security.done}
        </Button>
      </div>
    </section>
  );
}

export function EnabledPill() {
  return (
    <span className="flex items-center gap-[7px] rounded-pill bg-gain-bg px-2.5 py-1 text-small text-gain">
      <span className="size-[7px] rounded-full bg-gain" />
      <span>{ru.security.on}</span>
    </span>
  );
}
