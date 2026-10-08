CREATE TABLE `fin_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_id` text NOT NULL,
	`external_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`currency` text NOT NULL,
	`sync_enabled` integer DEFAULT true NOT NULL,
	`opened_at` text,
	`closed_at` text,
	`default_tag_id` text,
	`meta` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`default_tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "fin_accounts_kind_check" CHECK("fin_accounts"."kind" in ('broker', 'iis', 'wallet', 'deposit', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fin_accounts_source_external_idx` ON `fin_accounts` (`source_id`,`external_id`) WHERE "fin_accounts"."external_id" is not null;--> statement-breakpoint
CREATE INDEX `fin_accounts_user_idx` ON `fin_accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `instruments` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`asset_class` text NOT NULL,
	`ticker` text,
	`name` text NOT NULL,
	`isin` text,
	`figi` text,
	`external_uid` text,
	`currency` text NOT NULL,
	`lot` text DEFAULT '1' NOT NULL,
	`issuer` text,
	`meta` text,
	`user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "instruments_kind_check" CHECK("instruments"."kind" in ('share', 'bond', 'etf', 'currency', 'crypto', 'index', 'custom')),
	CONSTRAINT "instruments_class_check" CHECK("instruments"."asset_class" in ('stocks', 'bonds', 'funds', 'crypto', 'cash', 'other'))
);
--> statement-breakpoint
CREATE INDEX `instruments_ticker_idx` ON `instruments` (`ticker`);--> statement-breakpoint
CREATE UNIQUE INDEX `instruments_isin_idx` ON `instruments` (`isin`) WHERE "instruments"."isin" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `instruments_external_uid_idx` ON `instruments` (`external_uid`) WHERE "instruments"."external_uid" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `instruments_currency_idx` ON `instruments` (`ticker`) WHERE "instruments"."kind" = 'currency';--> statement-breakpoint
CREATE INDEX `instruments_user_idx` ON `instruments` (`user_id`);--> statement-breakpoint
CREATE TABLE `lot_closures` (
	`id` text PRIMARY KEY NOT NULL,
	`lot_id` text NOT NULL,
	`close_operation_id` text NOT NULL,
	`closed_at` integer NOT NULL,
	`quantity` text NOT NULL,
	`cost` text NOT NULL,
	`proceeds` text NOT NULL,
	`pnl` text NOT NULL,
	`holding_days` integer NOT NULL,
	FOREIGN KEY (`lot_id`) REFERENCES `lots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`close_operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lot_closures_lot_idx` ON `lot_closures` (`lot_id`);--> statement-breakpoint
CREATE INDEX `lot_closures_closed_idx` ON `lot_closures` (`closed_at`);--> statement-breakpoint
CREATE TABLE `lots` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`tag_id` text,
	`open_operation_id` text NOT NULL,
	`opened_at` integer NOT NULL,
	`quantity` text NOT NULL,
	`remaining` text NOT NULL,
	`unit_cost` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `fin_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`open_operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lots_cell_idx` ON `lots` (`account_id`,`instrument_id`);--> statement-breakpoint
CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`instrument_id` text,
	`type` text NOT NULL,
	`executed_at` integer NOT NULL,
	`quantity` text DEFAULT '0' NOT NULL,
	`price` text DEFAULT '0' NOT NULL,
	`currency` text NOT NULL,
	`amount` text DEFAULT '0' NOT NULL,
	`fee` text DEFAULT '0' NOT NULL,
	`tax` text DEFAULT '0' NOT NULL,
	`accrued_interest` text DEFAULT '0' NOT NULL,
	`tag_id` text,
	`note` text,
	`origin` text NOT NULL,
	`source_id` text NOT NULL,
	`external_id` text,
	`raw` text,
	`voided_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `fin_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "operations_type_check" CHECK("operations"."type" in ('buy', 'sell', 'dividend', 'coupon', 'interest', 'accrual', 'deposit', 'withdrawal', 'fee', 'tax', 'transfer_in', 'transfer_out', 'fx_buy', 'fx_sell', 'redemption', 'amortization', 'split', 'other')),
	CONSTRAINT "operations_origin_check" CHECK("operations"."origin" in ('tinvest', 'chain', 'manual', 'reconcile'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operations_source_external_idx` ON `operations` (`source_id`,`external_id`) WHERE "operations"."external_id" is not null;--> statement-breakpoint
CREATE INDEX `operations_account_executed_idx` ON `operations` (`account_id`,`executed_at`);--> statement-breakpoint
CREATE INDEX `operations_instrument_executed_idx` ON `operations` (`instrument_id`,`executed_at`);--> statement-breakpoint
CREATE INDEX `operations_user_executed_idx` ON `operations` (`user_id`,`executed_at`);--> statement-breakpoint
CREATE TABLE `positions` (
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`tag_id` text,
	`quantity` text NOT NULL,
	`cost_basis` text NOT NULL,
	`avg_price` text NOT NULL,
	`realized_pnl` text NOT NULL,
	`payouts_total` text NOT NULL,
	`first_buy_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `fin_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `positions_user_idx` ON `positions` (`user_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`secret_encrypted` blob,
	`schedule_minutes` integer,
	`last_sync_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sources_kind_check" CHECK("sources"."kind" in ('tinvest', 'wallet', 'manual')),
	CONSTRAINT "sources_status_check" CHECK("sources"."status" in ('ok', 'error', 'disabled'))
);
--> statement-breakpoint
CREATE INDEX `sources_user_idx` ON `sources` (`user_id`);--> statement-breakpoint
CREATE TABLE `tag_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`instrument_id` text,
	`tag_id` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `fin_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tag_rules_account_idx` ON `tag_rules` (`account_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_user_name_idx` ON `tags` (`user_id`,`name`);--> statement-breakpoint
DROP INDEX `jobs_singleton_active_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_singleton_queued_idx` ON `jobs` (`singleton_key`) WHERE "jobs"."singleton_key" is not null and "jobs"."status" = 'queued';