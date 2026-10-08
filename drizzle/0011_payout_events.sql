CREATE TABLE `payout_events` (
	`id` text PRIMARY KEY NOT NULL,
	`instrument_id` text NOT NULL,
	`kind` text NOT NULL,
	`record_date` text,
	`pay_date` text NOT NULL,
	`amount_per_unit` text NOT NULL,
	`currency` text NOT NULL,
	`source` text NOT NULL,
	`is_estimate` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "payout_events_kind_check" CHECK("payout_events"."kind" in ('dividend', 'coupon', 'redemption', 'amortization', 'offer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payout_events_instrument_kind_pay_idx` ON `payout_events` (`instrument_id`,`kind`,`pay_date`);--> statement-breakpoint
CREATE INDEX `payout_events_pay_date_idx` ON `payout_events` (`pay_date`);