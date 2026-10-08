'use client';

import { Select as RSelect } from 'radix-ui';
import { IconCheck, IconChevronDown } from '@/components/icons';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';
import { controlClass, type ControlTone } from './field';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  id?: string;
  placeholder?: string;
  tone?: ControlTone;
  invalid?: boolean;
  disabled?: boolean;
  required?: boolean;
  'aria-describedby'?: string;
  'aria-label'?: string;
  className?: string;
}

export function Select({
  options,
  placeholder,
  tone = 'card',
  invalid,
  className,
  id,
  ...rest
}: SelectProps) {
  const { 'aria-describedby': describedBy, 'aria-label': ariaLabel, ...root } = rest;
  return (
    <RSelect.Root {...root}>
      <RSelect.Trigger
        id={id}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={cn(
          controlClass(tone, invalid),
          'inline-flex cursor-pointer items-center justify-between gap-2 text-left data-[placeholder]:text-faint',
          className,
        )}
      >
        <RSelect.Value placeholder={placeholder ?? ru.common.selectPlaceholder} />
        <RSelect.Icon className="text-muted">
          <IconChevronDown />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-control border border-border bg-surface-2 text-row text-text"
        >
          <RSelect.Viewport className="p-1">
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex min-h-11 cursor-pointer items-center rounded-nav pr-3 pl-8 outline-none select-none data-[disabled]:text-faint data-[highlighted]:bg-pressed"
              >
                <RSelect.ItemIndicator className="absolute left-2.5 text-accent">
                  <IconCheck />
                </RSelect.ItemIndicator>
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}
