-- Full-text search over log messages (FTS5, external content = logs).
CREATE VIRTUAL TABLE `logs_fts` USING fts5(`message`, content='logs', content_rowid='id', tokenize='unicode61');
--> statement-breakpoint
CREATE TRIGGER `logs_fts_ai` AFTER INSERT ON `logs` BEGIN
  INSERT INTO `logs_fts`(rowid, `message`) VALUES (new.`id`, new.`message`);
END;
--> statement-breakpoint
CREATE TRIGGER `logs_fts_ad` AFTER DELETE ON `logs` BEGIN
  INSERT INTO `logs_fts`(`logs_fts`, rowid, `message`) VALUES ('delete', old.`id`, old.`message`);
END;
--> statement-breakpoint
CREATE TRIGGER `logs_fts_au` AFTER UPDATE ON `logs` BEGIN
  INSERT INTO `logs_fts`(`logs_fts`, rowid, `message`) VALUES ('delete', old.`id`, old.`message`);
  INSERT INTO `logs_fts`(rowid, `message`) VALUES (new.`id`, new.`message`);
END;
