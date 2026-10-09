CREATE TABLE `snapshot_totals` (
	`user_id` text NOT NULL,
	`date` text NOT NULL,
	`account_id` text NOT NULL,
	`tag_id` text,
	`value_rub` text NOT NULL,
	`cash_rub` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `fin_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `snapshot_totals_user_date_idx` ON `snapshot_totals` (`user_id`,`date`);--> statement-breakpoint
CREATE INDEX `snapshot_totals_account_idx` ON `snapshot_totals` (`account_id`,`date`);