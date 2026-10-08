'use client';

import { useEffect, useState } from 'react';

const format = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** «14:32» until `until`; calls onDone once when it reaches zero. */
export function Countdown({ until, onDone }: { until: Date; onDone?: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const left = until.getTime() - now;

  useEffect(() => {
    if (left <= 0) {
      onDone?.();
      return;
    }
    const timer = setTimeout(() => setNow(Date.now()), Math.min(1000, left));
    return () => clearTimeout(timer);
  }, [left, onDone]);

  return (
    <span className="num text-[22px]" role="timer" aria-live="off">
      {format(left)}
    </span>
  );
}
