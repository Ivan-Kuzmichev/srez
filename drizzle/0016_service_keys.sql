CREATE TABLE `service_keys` (
	`name` text PRIMARY KEY NOT NULL,
	`secret_encrypted` blob NOT NULL,
	`last4` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
