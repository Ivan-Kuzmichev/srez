CREATE TABLE `wallet_balances` (
	`date` text NOT NULL,
	`account_id` text NOT NULL,
	`instrument_id` text NOT NULL,
	`balance` text NOT NULL,
	`rate` text,
	PRIMARY KEY(`date`, `account_id`, `instrument_id`),
	FOREIGN KEY (`account_id`) REFERENCES `fin_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instrument_id`) REFERENCES `instruments`(`id`) ON UPDATE no action ON DELETE cascade
);
