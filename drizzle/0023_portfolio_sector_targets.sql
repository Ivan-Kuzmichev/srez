CREATE TABLE `portfolio_sector_targets` (
	`portfolio_id` text NOT NULL,
	`sector` text NOT NULL,
	`target_pct` text NOT NULL,
	PRIMARY KEY(`portfolio_id`, `sector`),
	FOREIGN KEY (`portfolio_id`) REFERENCES `portfolios`(`id`) ON UPDATE no action ON DELETE cascade
);
