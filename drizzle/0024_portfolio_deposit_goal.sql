ALTER TABLE `portfolios` ADD `deposit_goal` text;--> statement-breakpoint
ALTER TABLE `portfolios` ADD `deposit_period` text DEFAULT 'month' NOT NULL;--> statement-breakpoint
ALTER TABLE `portfolios` ADD `deposit_year_start` integer DEFAULT 1 NOT NULL;