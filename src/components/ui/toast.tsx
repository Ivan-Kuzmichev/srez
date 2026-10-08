'use client';

import { Toast as RToast } from 'radix-ui';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { IconAlert, IconCheck, IconClose } from '@/components/icons';
import { cn } from '@/lib/cn';
import { ru } from '@/lib/i18n/ru';

type ToastTone = 'success' | 'error';

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

type Notify = (toast: Omit<ToastItem, 'id'>) => void;

const ToastContext = createContext<Notify | null>(null);

/** Shows the result of an action: `const notify = useToast(); notify({ tone: 'success', title })`. */
export function useToast(): Notify {
  const notify = useContext(ToastContext);
  if (!notify) throw new Error('useToast must be used inside <ToastProvider>');
  return notify;
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const notify = useCallback<Notify>(
    (toast) => setItems((list) => [...list, { ...toast, id: nextId++ }]),
    [],
  );
  const remove = (id: number) => setItems((list) => list.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={notify}>
      <RToast.Provider swipeDirection="down" duration={5000}>
        {children}
        {items.map((t) => (
          <RToast.Root
            key={t.id}
            type={t.tone === 'error' ? 'foreground' : 'background'}
            duration={t.tone === 'error' ? 10_000 : 5000}
            onOpenChange={(open) => !open && remove(t.id)}
            className={cn(
              'flex items-start gap-2.5 rounded-control border bg-surface-2 px-3.5 py-3 text-row',
              t.tone === 'error' ? 'border-loss-border' : 'border-border',
            )}
          >
            <span className={cn('flex pt-0.5', t.tone === 'error' ? 'text-loss' : 'text-gain')}>
              {t.tone === 'error' ? <IconAlert /> : <IconCheck />}
            </span>
            <div className="flex flex-1 flex-col gap-0.5">
              <RToast.Title className="font-medium">{t.title}</RToast.Title>
              {t.description ? (
                <RToast.Description className="text-caption text-muted">{t.description}</RToast.Description>
              ) : null}
            </div>
            <RToast.Close
              aria-label={ru.common.close}
              className="-m-2 flex size-8 cursor-pointer items-center justify-center rounded-nav border-0 bg-transparent text-muted hover:text-text"
            >
              <IconClose />
            </RToast.Close>
          </RToast.Root>
        ))}
        {/* Above the phone tab bar, bottom right on wide screens. */}
        <RToast.Viewport className="fixed right-4 bottom-[calc(80px+env(safe-area-inset-bottom))] z-50 m-0 flex w-[calc(100vw-32px)] max-w-[380px] list-none flex-col gap-2 p-0 wide:bottom-6" />
      </RToast.Provider>
    </ToastContext.Provider>
  );
}
