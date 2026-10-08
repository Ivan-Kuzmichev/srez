CREATE TABLE `discrepancies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`ledger_qty` text NOT NULL,
	`broker_qty` text NOT NULL,
	`guess` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution_operation_id` text,
	`detected_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `fin_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolution_operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "discrepancies_guess_check" CHECK("discrepancies"."guess" in ('transfer', 'fx', 'redemption', 'split', 'unknown')),
	CONSTRAINT "discrepancies_status_check" CHECK("discrepancies"."status" in ('open', 'resolved', 'ignored', 'snoozed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discrepancies_active_idx` ON `discrepancies` (`account_id`,`instrument_id`) WHERE "discrepancies"."status" in ('open', 'snoozed');--> statement-breakpoint
CREATE INDEX `discrepancies_account_idx` ON `discrepancies` (`account_id`,`status`);--> statement-breakpoint
CREATE TABLE `reconcile_exclusions` (
	`account_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	PRIMARY KEY(`account_id`, `instrument_id`),
	FOREIGN KEY (`account_id`) REFERENCES `fin_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade
);
