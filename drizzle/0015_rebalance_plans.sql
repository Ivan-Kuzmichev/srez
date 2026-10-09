CREATE TABLE `rebalance_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`input` text NOT NULL,
	`result` text NOT NULL,
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rebalance_plans_portfolio_idx` ON `rebalance_plans` (`portfolio_id`,`created_at`);