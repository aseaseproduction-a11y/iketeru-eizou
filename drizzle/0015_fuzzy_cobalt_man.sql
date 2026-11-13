ALTER TABLE `aiMetadataCompletionJobs` ADD `consecutiveModelFailureCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `aiMetadataCompletionJobs` ADD `consecutiveModelFailureCount` int NOT NULL DEFAULT 0;
ALTER TABLE `aiMetadataCompletionJobs` ADD `retryAfter` timestamp;
