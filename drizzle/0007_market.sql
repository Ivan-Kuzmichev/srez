CREATE TABLE `fx_rates` (
	`date` text NOT NULL,
	`base` text NOT NULL,
	`quote` text NOT NULL,
	`rate` text NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`date`, `base`, `quote`)
);
--> statement-breakpoint
CREATE TABLE `portfolio_rules` (
	`portfolio_id` text NOT NULL,
	`account_id` text NOT NULL,
	`mode` text NOT NULL,
	`tag_id` text,
	PRIMARY KEY(`portfolio_id`, `account_id`),
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `fin_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "portfolio_rules_mode_check" CHECK("portfolio_rules"."mode" in ('all', 'tag')),
	CONSTRAINT "portfolio_rules_tag_check" CHECK(("portfolio_rules"."mode" = 'tag') = ("portfolio_rules"."tag_id" is not null))
);
--> statement-breakpoint
CREATE TABLE `portfolio_targets` (
	`portfolio_id` text NOT NULL,
	`asset_class` text NOT NULL,
	`target_pct` text NOT NULL,
	PRIMARY KEY(`portfolio_id`, `asset_class`),
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `portfolios` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`benchmark_instrument_id` text,
	`deviation_threshold` text DEFAULT '5' NOT NULL,
	`targets_enabled` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`benchmark_instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `portfolios_user_idx` ON `portfolios` (`user_id`);--> statement-breakpoint
CREATE TABLE `position_snapshots` (
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`account_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`tag_id` text,
	`quantity` text NOT NULL,
	`price` text NOT NULL,
	`currency` text NOT NULL,
	`value` text NOT NULL,
	`value_rub` text NOT NULL,
	`approx` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `fin_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `position_snapshots_user_date_idx` ON `position_snapshots` (`user_id`,`date`);--> statement-breakpoint
CREATE INDEX `position_snapshots_account_idx` ON `position_snapshots` (`account_id`,`date`);--> statement-breakpoint
CREATE TABLE `prices` (
	`instrument_id` text NOT NULL,
	`date` text NOT NULL,
	`close` text NOT NULL,
	`currency` text NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`instrument_id`, `date`),
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `prices_last` (
	`instrument_id` text PRIMARY KEY NOT NULL,
	`price` text NOT NULL,
	`currency` text NOT NULL,
	`at` integer NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
