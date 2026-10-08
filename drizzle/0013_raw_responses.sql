CREATE TABLE `raw_responses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`integration` text NOT NULL,
	`method` text NOT NULL,
	`status` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`body` text
);
--> statement-breakpoint
CREATE INDEX `raw_responses_ts_idx` ON `raw_responses` (`ts`);