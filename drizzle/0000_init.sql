CREATE TABLE `logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`level` text NOT NULL,
	`source` text NOT NULL,
	`message` text NOT NULL,
	`context` text,
	`request_id` text,
	`job_id` text,
	CONSTRAINT "logs_level_check" CHECK("logs"."level" in ('debug', 'info', 'warn', 'error'))
);
--> statement-breakpoint
CREATE INDEX `logs_ts_idx` ON `logs` (`ts`);--> statement-breakpoint
CREATE INDEX `logs_level_ts_idx` ON `logs` (`level`,`ts`);--> statement-breakpoint
CREATE INDEX `logs_source_ts_idx` ON `logs` (`source`,`ts`);--> statement-breakpoint
CREATE INDEX `logs_request_id_idx` ON `logs` (`request_id`);--> statement-breakpoint
CREATE INDEX `logs_job_id_idx` ON `logs` (`job_id`);