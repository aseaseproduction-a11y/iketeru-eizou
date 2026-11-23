ALTER TABLE `videos` ADD `calibrationStatus` varchar(32) DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `videos` ADD `calibratedScore` decimal(5,2) DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `videos` ADD `calibratedRank` varchar(8) DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `videos` ADD `calibratedTierBand` varchar(24) DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `videos` ADD `calibratedBreakdown` mediumtext DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `videos` ADD `calibrationVersion` varchar(32) DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `videos` ADD `calibratedAt` timestamp NULL DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `videos` ADD `calibratedRoute` varchar(32) DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `videos` ADD `calibratedRunId` varchar(64) DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `videos` ADD `calibrationGenreBucket` varchar(64) DEFAULT NULL;
--> statement-breakpoint
CREATE INDEX `idx_videos_calibration_status` ON `videos` (`calibrationStatus`);
--> statement-breakpoint
CREATE INDEX `idx_videos_calibrated_run_id` ON `videos` (`calibratedRunId`);
