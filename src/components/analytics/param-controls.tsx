'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';

function useParam(name: string, fallback: string) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const set = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === fallback) next.delete(name);
    else next.set(name, value);
    const q = next.toString();
    startTransition(() => router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false }));
  };
  return set;
}

/** A choice kept in the address bar as a segmented control: the year of «Прибыль за год». */
export function ParamSegmented({
  name,
  value,
  fallback,
  options,
  'aria-label': ariaLabel,
}: {
  name: string;
  value: string;
  fallback: string;
  options: { value: string; label: string }[];
  'aria-label': string;
}) {
  const set = useParam(name, fallback);
  return <Segmented aria-label={ariaLabel} mono value={value} onValueChange={set} options={options} />;
}

/** A choice kept in the address bar as a select: the cost method. */
export function ParamSelect({
  id,
  name,
  value,
  fallback,
  options,
}: {
  id?: string;
  name: string;
  value: string;
  fallback: string;
  options: { value: string; label: string }[];
}) {
  const set = useParam(name, fallback);
  return <Select id={id} value={value} onValueChange={set} options={options} />;
}
