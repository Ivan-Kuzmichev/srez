CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`new_operations` integer DEFAULT 0 NOT NULL,
	`progress` text,
	`error` text,
	`attempt` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sync_runs_trigger_check" CHECK("sync_runs"."trigger" in ('schedule', 'manual', 'api', 'onboarding')),
	CONSTRAINT "sync_runs_status_check" CHECK("sync_runs"."status" in ('running', 'ok', 'error'))
);
--> statement-breakpoint
CREATE INDEX `sync_runs_source_started_idx` ON `sync_runs` (`source_id`,`started_at`);--> statement-breakpoint
ALTER TABLE `operations` ADD `fingerprint` text;--> statement-breakpoint
CREATE INDEX `operations_source_fingerprint_idx` ON `operations` (`source_id`,`fingerprint`) WHERE "operations"."fingerprint" is not null;