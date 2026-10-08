'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { ru } from '@/lib/i18n/ru';

const KEY = 'srez.logs.autoRefresh';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function write(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // Storage blocked: the choice lasts until the page is left.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** «Обновлять сами»: a refresh every five seconds; the choice is remembered in this browser. */
export function AutoRefresh() {
  const router = useRouter();
  const on = useSyncExternalStore(subscribe, read, () => false);
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [on, router]);
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5">
      <input
        type="checkbox"
        className="m-0 size-[18px] shrink-0 accent-accent"
        checked={on}
        onChange={(e) => write(e.target.checked)}
      />
      <span>{ru.logs.autoRefresh}</span>
    </label>
  );
}
