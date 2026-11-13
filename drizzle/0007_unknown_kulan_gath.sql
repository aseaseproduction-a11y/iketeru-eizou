ALTER TABLE `videos` ADD `embedStatus` varchar(16) DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `videos` ADD `embedStatus` varchar(16) NOT NULL DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE `videos` ADD `embedCheckedAt` timestamp;
