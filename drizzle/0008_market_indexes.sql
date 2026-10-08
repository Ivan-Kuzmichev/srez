-- One snapshot per (date, account, instrument, tag) with a nullable tag; drizzle-kit mangles expressions.
CREATE UNIQUE INDEX `position_snapshots_cell_idx` ON `position_snapshots` (`date`, `account_id`, `instrument_id`, coalesce(`tag_id`, ''));
