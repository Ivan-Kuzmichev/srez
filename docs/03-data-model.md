# Модель данных

Схема описана на уровне контракта. Имена таблиц и полей обязательны, типы индексов и мелкие детали на усмотрение реализации.

Общие правила:

- Первичные ключи: `uuid` (v7), кроме `logs` (`bigserial`).
- У всех таблиц с пользовательскими данными есть `user_id`.
- Числа: `numeric(38, 18)`. Время: `timestamptz`. Даты без времени: `date`.
- Перечисления — Postgres enum или `text` с проверкой, значения латиницей в нижнем регистре.
- Мягкого удаления нет, кроме `operations` (см. ниже).

## 1. Аутентификация

Таблицы `user`, `session`, `account`, `verification`, `two_factor`, `passkey` создаёт Better Auth. Генерируй их его CLI и не правь руками. Имя `account` занято им, поэтому финансовые счета называются `fin_accounts`.

Дополнительно:

**login_attempts** — для блокировки.
`id`, `username`, `ip`, `success bool`, `created_at`.

**api_tokens**
`id`, `user_id`, `name`, `token_hash` (sha-256), `last4`, `scopes text[]`, `local_only bool`, `expires_at`, `last_used_at`, `last_used_ip`, `last_used_path`, `revoked_at`, `created_at`.

## 2. Источники и счета

**sources**
`id`, `user_id`, `kind` (`tinvest` | `wallet` | `manual`), `name`, `status` (`ok` | `error` | `disabled`), `secret_encrypted bytea` (токен, только для `tinvest`), `schedule_minutes int`, `last_sync_at`, `last_error text`, `created_at`.

**fin_accounts**
`id`, `user_id`, `source_id`, `external_id text` (id счёта у брокера или адрес кошелька), `name`, `kind` (`broker` | `iis` | `wallet` | `deposit` | `other`), `currency`, `sync_enabled bool`, `opened_at date`, `closed_at date`, `default_tag_id`, `meta jsonb`.
Для кошелька в `meta`: `{ family: 'evm'|'bitcoin'|..., networks: [...], loadHistory: bool }`.
Уникальность: `(source_id, external_id)`.

**sync_runs**
`id`, `source_id`, `trigger` (`schedule` | `manual` | `api` | `onboarding`), `status` (`running` | `ok` | `error`), `started_at`, `finished_at`, `new_operations int`, `progress jsonb` (для мастера: счёт, год, процент), `error text`, `attempt int`.

## 3. Инструменты и цены

**instruments**
`id`, `kind` (`share` | `bond` | `etf` | `currency` | `crypto` | `index` | `custom`), `asset_class` (`stocks` | `bonds` | `funds` | `crypto` | `cash` | `other`), `ticker`, `name`, `isin`, `figi`, `external_uid` (uid Т-Инвестиций), `currency`, `lot numeric`, `issuer text`, `meta jsonb`, `user_id` (только для `custom`), `created_at`.

`meta` по видам:

- облигация: `{ nominal, couponType: 'fixed'|'floating', couponRate, maturityDate, amortization: bool }`;
- крипта: `{ chain, contract, decimals, coingeckoId, yieldKind: 'none'|'rebasing'|'wrapped', underlyingId }`;
- свой актив: `{ valuation: 'manual'|'interest', annualRate }`.

**prices** — дневные цены закрытия.
`instrument_id`, `date`, `close`, `currency`, `source`. Первичный ключ `(instrument_id, date)`.

**prices_last** — последняя известная цена.
`instrument_id` (pk), `price`, `currency`, `at`.

**fx_rates**
`date`, `base`, `quote`, `rate`, `source`. Первичный ключ `(date, base, quote)`. Базой всегда хранится рубль, кросс-курсы считаются.

**payout_events** — расписание выплат по инструменту.
`id`, `instrument_id`, `kind` (`dividend` | `coupon` | `redemption` | `amortization` | `offer`), `record_date`, `pay_date`, `amount_per_unit`, `currency`, `source`, `is_estimate bool`.
Уникальность: `(instrument_id, kind, pay_date)`.

## 4. Журнал

**tags**
`id`, `user_id`, `name`. Уникальность `(user_id, name)`.

**tag_rules** — какой тег получают операции автоматически.
`id`, `account_id`, `instrument_id` (nullable), `tag_id`.
Порядок разрешения тега для операции: явный тег операции → правило для пары «счёт, инструмент» → `fin_accounts.default_tag_id` → без тега.

**operations**

| Поле | Тип | Пояснение |
|---|---|---|
| `id` | uuid | |
| `user_id`, `account_id` | uuid | |
| `instrument_id` | uuid, nullable | Пусто у денежных операций без бумаги |
| `type` | enum | См. список ниже |
| `executed_at` | timestamptz | |
| `quantity` | numeric | Всегда ≥ 0, направление задаёт тип |
| `price` | numeric | За единицу, в `currency`. У облигаций в деньгах, не в процентах |
| `currency` | text | |
| `amount` | numeric | Денежный эффект со знаком: минус — деньги ушли со счёта |
| `fee` | numeric | ≥ 0, в `currency` |
| `tax` | numeric | ≥ 0 |
| `accrued_interest` | numeric | НКД, только облигации |
| `tag_id` | uuid, nullable | Явный тег |
| `note` | text | |
| `origin` | enum | `tinvest` \| `chain` \| `manual` \| `reconcile` |
| `source_id` | uuid | |
| `external_id` | text, nullable | Идентификатор во внешней системе |
| `raw` | jsonb, nullable | Сырой ответ, только в режиме отладки, без секретов |
| `voided_at` | timestamptz, nullable | Отмена исправления сверки |
| `created_at`, `updated_at` | | |

Типы операций: `buy`, `sell`, `dividend`, `coupon`, `interest`, `accrual`, `deposit`, `withdrawal`, `fee`, `tax`, `transfer_in`, `transfer_out`, `fx_buy`, `fx_sell`, `redemption`, `amortization`, `split`, `other`.

Инварианты:

- Уникальность `(source_id, external_id)` там, где `external_id` не пуст.
- Операции с `origin` из `tinvest` и `chain` не редактируются, кроме `tag_id` и `note`.
- Отменённые (`voided_at` не пуст) не участвуют в расчётах.
- Индексы: `(account_id, executed_at)`, `(instrument_id, executed_at)`, `(user_id, executed_at desc)`.

## 5. Производные таблицы

Перезаписываются задачей `positions.recalc`. Руками не правятся.

**positions**
`account_id`, `instrument_id`, `tag_id` (nullable), `quantity`, `cost_basis` (в валюте инструмента), `avg_price`, `realized_pnl`, `payouts_total`, `first_buy_at`, `updated_at`. Первичный ключ `(account_id, instrument_id, tag_id)`.

**lots** — открытые и закрытые лоты FIFO.
`id`, `account_id`, `instrument_id`, `tag_id`, `open_operation_id`, `opened_at`, `quantity`, `remaining`, `unit_cost`.

**lot_closures**
`id`, `lot_id`, `close_operation_id`, `closed_at`, `quantity`, `cost`, `proceeds`, `pnl`, `holding_days`.

**position_snapshots** — стоимость на конец дня.
`date`, `account_id`, `instrument_id`, `tag_id`, `quantity`, `price`, `currency`, `value` (в валюте инструмента), `value_rub`. Первичный ключ `(date, account_id, instrument_id, tag_id)`.

**cash_flows_daily** — внешние потоки по ячейке «счёт, тег» за день, для TWR и XIRR.
`date`, `account_id`, `tag_id`, `amount_rub`. См. определение потока в `04-calculations.md`.

**wallet_balances** — остатки доходных токенов для расчёта начислений.
`date`, `account_id`, `instrument_id`, `balance`, `rate` (курс обёртки к базовой монете, если есть).

## 6. Портфели

**portfolios**
`id`, `user_id`, `name`, `benchmark_instrument_id` (nullable), `deviation_threshold numeric` (п.п.), `targets_enabled bool`, `sort int`, `created_at`.

**portfolio_rules**
`portfolio_id`, `account_id`, `mode` (`all` | `tag`), `tag_id` (nullable). Счёт без правила в портфель не входит.

**portfolio_targets**
`portfolio_id`, `asset_class`, `target_pct`. Сумма по портфелю равна 100, проверяется при сохранении.

**rebalance_plans**
`id`, `portfolio_id`, `created_at`, `input jsonb`, `result jsonb`.

Ячейка портфеля — пара `(account_id, tag_id)`. Портфель с правилом `all` включает все ячейки счёта, с правилом `tag` — одну.

## 7. Сверка

**discrepancies**
`id`, `account_id`, `instrument_id`, `ledger_qty`, `broker_qty`, `guess` (`transfer` | `fx` | `redemption` | `split` | `unknown`), `status` (`open` | `resolved` | `ignored` | `snoozed`), `resolution_operation_id`, `detected_at`, `resolved_at`.
Одно открытое расхождение на пару «счёт, инструмент».

**reconcile_exclusions**
`account_id`, `instrument_id`.

## 8. Настройки и служебное

**settings** — одна строка на пользователя.
`user_id` (pk), `data jsonb`, `updated_at`. Структура `data` описана Zod-схемой с значениями по умолчанию:

```
{
  display: { baseCurrency: 'RUB', extraCurrencies: ['USD','EUR'], timezone },
  returns: { primaryMetric: 'xirr', includeCash: true, deductFees: true, defaultBenchmarkId },
  prices:  { refreshMinutes: 15, snapshotTime: '23:50' },
  limits:  { issuerPct: 15, singleStockPct: 8, cryptoPct: 15, notify: true },
  crypto:  { priceSource: 'coingecko', dustThresholdRub: 100, hideUnpriced: true },
  notify:  { telegram: { chatId, enabled }, events: {...}, thresholds: { deviationPp: 5, dayMovePct: 7 } },
  logging: { level: 'info', retentionDays: 14, externalRequests: true, authEvents: true, maskAmounts: false },
  debug:   { enabled: false, autoOffAt }
}
```

Токен Telegram-бота хранится отдельно в зашифрованном виде: таблица **secrets** (`user_id`, `name`, `value_encrypted`).

**notifications_state** — чтобы не слать одно и то же.
`user_id`, `key text` (например `limit:singleStock:<instrument>`), `active bool`, `last_sent_at`.

**logs**
`id bigserial`, `ts`, `level` (`debug` | `info` | `warn` | `error`), `source`, `message`, `context jsonb`, `request_id`, `job_id`. Индексы по `ts desc`, `(level, ts)`, `(source, ts)`, полнотекстовый по `message`.

**raw_responses** — только в режиме отладки, срок жизни 24 часа.
`id`, `ts`, `integration`, `method`, `status`, `duration_ms`, `body jsonb`.

Очередь задач pg-boss живёт в своей схеме `pgboss`.
