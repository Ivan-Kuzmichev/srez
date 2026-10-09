CREATE TABLE `notifications_state` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`active` integer NOT NULL,
	`last_sent_at` integer,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
