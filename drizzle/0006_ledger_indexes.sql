-- Expression indexes drizzle-kit cannot express, and the built-in cash instruments.
CREATE UNIQUE INDEX `positions_cell_idx` ON `positions` (`account_id`, `instrument_id`, coalesce(`tag_id`, ''));
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_rules_account_instrument_idx` ON `tag_rules` (`account_id`, coalesce(`instrument_id`, ''));
--> statement-breakpoint
CREATE UNIQUE INDEX `instruments_coingecko_idx` ON `instruments` (json_extract(`meta`, '$.coingeckoId'))
  WHERE `kind` = 'crypto' AND json_extract(`meta`, '$.coingeckoId') IS NOT NULL;
--> statement-breakpoint
INSERT INTO `instruments` (`id`, `kind`, `asset_class`, `ticker`, `name`, `currency`, `lot`, `created_at`) VALUES
  ('0199c3a0-0000-7000-8000-000000000001', 'currency', 'cash', 'RUB', 'Рубли', 'RUB', '1', 1791417600000),
  ('0199c3a0-0000-7000-8000-000000000002', 'currency', 'cash', 'USD', 'Доллары США', 'USD', '1', 1791417600000),
  ('0199c3a0-0000-7000-8000-000000000003', 'currency', 'cash', 'EUR', 'Евро', 'EUR', '1', 1791417600000),
  ('0199c3a0-0000-7000-8000-000000000004', 'currency', 'cash', 'CNY', 'Юани', 'CNY', '1', 1791417600000);
