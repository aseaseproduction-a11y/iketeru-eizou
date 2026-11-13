CREATE TABLE `aiMetadataCompletionJobs` (
	`id` varchar(64) NOT NULL,
	`scheduleCronTaskUid` varchar(65),
	`enabled` int NOT NULL DEFAULT 1,
	`batchSize` int NOT NULL DEFAULT 5,
	`lastRunAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `aiMetadataCompletionJobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `aiMetadataCompletionRuns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskUid` varchar(65),
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`status` varchar(32) NOT NULL,
	`selectedCount` int NOT NULL DEFAULT 0,
	`analyzedCount` int NOT NULL DEFAULT 0,
	`auditedCount` int NOT NULL DEFAULT 0,
	`savedValueCount` int NOT NULL DEFAULT 0,
	`skippedCount` int NOT NULL DEFAULT 0,
	`details` mediumtext,
	CONSTRAINT `aiMetadataCompletionRuns_id` PRIMARY KEY(`id`)
);
