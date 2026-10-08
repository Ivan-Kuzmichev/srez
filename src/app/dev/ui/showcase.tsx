'use client';

import { useState, type ReactNode } from 'react';
import { IconOperations, IconSettings, IconSources, IconWallet } from '@/components/icons';
import { Logo } from '@/components/logo';
import { Alert } from '@/components/ui/alert';
import { ASSET_CLASS_COLOR, AllocationBar } from '@/components/ui/allocation-bar';
import { Button, IconButton } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Checkbox, ChoiceGroup, Radio } from '@/components/ui/choice';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ActionTile, EmptyState } from '@/components/ui/empty-state';
import { Field, Input } from '@/components/ui/field';
import { ListRow } from '@/components/ui/list-row';
import { Metric } from '@/components/ui/metric';
import { LevelTag, Pill } from '@/components/ui/pill';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { CardSkeleton, Skeleton } from '@/components/ui/skeleton';
import { TabLinks } from '@/components/ui/tab-links';
import { Table, Td, Th } from '@/components/ui/table';
import { TargetBar } from '@/components/ui/target-bar';
import { useToast } from '@/components/ui/toast';

// Sample content for the showcase only. Real screens get every value from the server.
const sample = {
  classes: [
    { key: 'stocks', label: 'Акции', share: 40, amount: '4 000 ₽', shareLabel: '40,0 %' },
    { key: 'bonds', label: 'Облигации', share: 25, amount: '2 500 ₽', shareLabel: '25,0 %' },
    { key: 'funds', label: 'Фонды', share: 15, amount: '1 500 ₽', shareLabel: '15,0 %' },
    { key: 'crypto', label: 'Крипта', share: 12, amount: '1 200 ₽', shareLabel: '12,0 %' },
    { key: 'cash', label: 'Кэш', share: 8, amount: '800 ₽', shareLabel: '8,0 %' },
  ] as const,
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} />
      {children}
    </Card>
  );
}

export function Showcase() {
  const [currency, setCurrency] = useState('rub');
  const [period, setPeriod] = useState('1y');
  const notify = useToast();

  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-4 p-4 wide:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <Logo />
        <h1 className="m-0 text-page-phone font-semibold tracking-[-0.01em] wide:text-page">Компоненты</h1>
      </header>

      <Section title="Кнопки">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Главная</Button>
          <Button variant="secondary">Вторичная</Button>
          <Button variant="secondary-raised">Вторичная в карточке</Button>
          <Button variant="text">Текстовая</Button>
          <Button variant="danger">Опасная</Button>
          <Button variant="danger-text">Удалить</Button>
          <Button variant="primary" disabled>
            Недоступна
          </Button>
          <IconButton label="Настройки">
            <IconSettings />
          </IconButton>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" size="lg" className="flex-1">
            Сохранить (телефон)
          </Button>
          <Button variant="secondary-raised" size="lg" className="flex-1">
            Отмена
          </Button>
        </div>
      </Section>

      <Section title="Поля">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3">
          <Field label="Название">
            {(f) => <Input id={f.id} aria-describedby={f.describedBy} placeholder="Например, ИИС" />}
          </Field>
          <Field label="Сумма" hint="В валюте счёта">
            {(f) => <Input id={f.id} aria-describedby={f.describedBy} mono inputMode="decimal" />}
          </Field>
          <Field label="Количество" error="Должно быть больше нуля">
            {(f) => (
              <Input id={f.id} aria-describedby={f.describedBy} invalid={f.invalid} mono defaultValue="0" />
            )}
          </Field>
          <Field label="Счёт">
            {(f) => (
              <Select
                id={f.id}
                aria-describedby={f.describedBy}
                options={[
                  { value: 'broker', label: 'Брокерский' },
                  { value: 'iis', label: 'ИИС' },
                  { value: 'wallet', label: 'Кошелёк' },
                ]}
              />
            )}
          </Field>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3">
          <ChoiceGroup legend="Флажки">
            <Checkbox label="Синхронизировать" defaultChecked />
            <Checkbox label="Загружать историю" description="Может занять несколько минут" />
          </ChoiceGroup>
          <ChoiceGroup legend="Переключатель">
            <Radio name="kind" label="Сделка" defaultChecked />
            <Radio name="kind" label="Пополнение или вывод" />
          </ChoiceGroup>
        </div>
      </Section>

      <Section title="Переключатели и вкладки">
        <div className="flex flex-wrap gap-3">
          <Segmented
            aria-label="Валюта"
            mono
            value={currency}
            onValueChange={setCurrency}
            options={[
              { value: 'rub', label: '₽', ariaLabel: 'Рубли' },
              { value: 'usd', label: '$', ariaLabel: 'Доллары' },
              { value: 'eur', label: '€', ariaLabel: 'Евро' },
            ]}
          />
          <Segmented
            aria-label="Период"
            value={period}
            onValueChange={setPeriod}
            options={[
              { value: '1m', label: '1М' },
              { value: '6m', label: '6М' },
              { value: '1y', label: '1Г' },
              { value: 'all', label: 'Всё' },
            ]}
          />
        </div>
        <TabLinks
          aria-label="Разделы аналитики"
          items={[
            { href: '/dev/ui', label: 'Текущая' },
            { href: '/analytics/bonds', label: 'Облигации' },
            { href: '/analytics/realized', label: 'Прибыль за год' },
          ]}
        />
      </Section>

      <Section title="Пилюли">
        <div className="flex flex-wrap gap-2">
          <Pill tone="accent">Тег</Pill>
          <Pill tone="gain">Синхронизирован</Pill>
          <Pill tone="loss">Ошибка</Pill>
          <Pill tone="neutral">Вручную</Pill>
          <Pill tone="warn">Внимание</Pill>
          <LevelTag tone="warn">WARN</LevelTag>
          <LevelTag tone="loss">ERROR</LevelTag>
          <LevelTag>INFO</LevelTag>
        </div>
      </Section>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-4">
        <Section title="Показатели">
          <Metric size="hero" label="Стоимость" value="10 000 ₽" hint="Пример" />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(120px,100%),1fr))] gap-4 border-t border-border pt-5">
            <Metric size="sm" label="Вложено" value="9 000 ₽" />
            <Metric size="sm" label="Прибыль" value="+1 000 ₽" tone="gain" />
            <Metric size="sm" label="За день" value="−10 ₽" tone="loss" />
          </div>
        </Section>
        <Section title="Строки списка">
          <div>
            <ListRow title="Брокерский счёт" subtitle="Т-Инвестиции" value="5 000 ₽" valueHint="+2,0 %" />
            <ListRow title="Кошелёк" subtitle="Вручную" value="1 200 ₽" valueHint="−0,5 %" />
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-4">
        <Section title="Структура">
          <AllocationBar
            aria-label="Структура по классам активов"
            segments={sample.classes.map((c) => ({ ...c, colorClass: ASSET_CLASS_COLOR[c.key] }))}
          />
        </Section>
        <Card>
          <CardHeader title="Факт против цели" aside="факт / цель" />
          <TargetBar label="Акции" valueLabel="40,0 / 40 %" actual={40} target={40} scaleMax={50} />
          <TargetBar
            label="Облигации"
            valueLabel="15,0 / 25 %"
            actual={15}
            target={25}
            scaleMax={50}
            offTarget
          />
        </Card>
      </div>

      <Section title="Таблица">
        <Table minWidth={640}>
          <thead>
            <tr>
              <Th>Дата</Th>
              <Th>Операция</Th>
              <Th align="right">Сумма</Th>
              <Th>Счёт</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td mono className="text-caption text-muted">
                1 янв
              </Td>
              <Td>Покупка</Td>
              <Td align="right" mono>
                −1 000,00
              </Td>
              <Td>Брокерский</Td>
            </tr>
            <tr>
              <Td mono className="text-caption text-muted">
                2 янв
              </Td>
              <Td>Дивиденды</Td>
              <Td align="right" mono className="text-gain">
                +100,00
              </Td>
              <Td>Брокерский</Td>
            </tr>
          </tbody>
        </Table>
      </Section>

      <Section title="Предупреждения и результат">
        <Alert>Неверный логин или пароль.</Alert>
        <Alert tone="warn">Источник давно не синхронизировался.</Alert>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary-raised" onClick={() => notify({ tone: 'success', title: 'Сохранено' })}>
            Показать успех
          </Button>
          <Button
            variant="secondary-raised"
            onClick={() =>
              notify({ tone: 'error', title: 'Не сохранилось', description: 'Попробуйте ещё раз' })
            }
          >
            Показать ошибку
          </Button>
          <ConfirmDialog
            trigger={<Button variant="danger">Удалить портфель</Button>}
            title="Удалить портфель?"
            description="Операции и счета останутся, удалится только выборка."
            confirmLabel="Удалить"
            danger
            onConfirm={() => notify({ tone: 'success', title: 'Портфель удалён' })}
          />
        </div>
      </Section>

      <EmptyState
        figure="0 ₽"
        title="Данных пока нет"
        description="Подключите источник или внесите первую операцию."
        actions={
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
            <ActionTile
              primary
              href="/onboarding"
              icon={<IconSources size={22} />}
              title="Подключить брокера"
            />
            <ActionTile
              href="/sources/wallets/new"
              icon={<IconWallet size={22} />}
              title="Добавить кошелёк"
            />
            <ActionTile href="/operations/new" icon={<IconOperations size={22} />} title="Внести операцию" />
          </div>
        }
      />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-4">
        <CardSkeleton />
        <Section title="Заглушки">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-[200px] w-full" />
        </Section>
      </div>
    </main>
  );
}
