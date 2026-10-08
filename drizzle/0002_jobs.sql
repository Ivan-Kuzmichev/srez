CREATE TABLE `job_schedules` (
	`name` text PRIMARY KEY NOT NULL,
	`cron` text NOT NULL,
	`payload` text,
	`last_enqueued_at` integer
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`payload` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`run_at` integer NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`singleton_key` text,
	`locked_by` text,
	`locked_until` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	CONSTRAINT "jobs_status_check" CHECK("jobs"."status" in ('queued', 'running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `jobs_status_run_at_idx` ON `jobs` (`status`,`run_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_singleton_active_idx` ON `jobs` (`singleton_key`) WHERE "jobs"."singleton_key" is not null and "jobs"."status" in ('queued', 'running');