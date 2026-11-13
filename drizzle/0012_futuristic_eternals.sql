CREATE TABLE `dailyCollectionRuns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`taskUid` varchar(65),
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`status` varchar(32) NOT NULL,
	`candidateCount` int NOT NULL DEFAULT 0,
	`insertedCount` int NOT NULL DEFAULT 0,
	`skippedCount` int NOT NULL DEFAULT 0,
	`details` mediumtext,
	CONSTRAINT `dailyCollectionRuns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dailyCollectionSources` (
	`id` varchar(64) NOT NULL,
	`label` varchar(128) NOT NULL,
	`url` text NOT NULL,
	`enabled` int NOT NULL DEFAULT 1,
	`scheduleCronTaskUid` varchar(65),
	`lastCheckedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dailyCollectionSources_id` PRIMARY KEY(`id`)
);
