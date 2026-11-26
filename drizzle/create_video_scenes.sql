-- Idempotent DDL for TiDB Cloud Serverless / MySQL 8
-- Adds an independent `videoScenes` table without modifying `videos` or any existing table.
-- Apply ONLY after user approval and acquiring `analysis/claims/_apply_lock.json`
-- with run_id = "sync_video_scenes_to_tidb".

CREATE TABLE IF NOT EXISTS `videoScenes` (
  `id` int AUTO_INCREMENT NOT NULL,
  `videoId` varchar(64) NOT NULL,
  `shotIndex` int NOT NULL,
  `startMmss` varchar(16) NOT NULL,
  `endMmss` varchar(16) NOT NULL,
  `startSec` decimal(8,2) NOT NULL DEFAULT 0.00,
  `endSec` decimal(8,2) NOT NULL DEFAULT 0.00,
  `durationSec` decimal(8,2) NOT NULL DEFAULT 0.00,
  `shotTitle` varchar(255) NOT NULL DEFAULT '',
  `description` text NOT NULL,
  `audioText` text,
  `keywordsJson` text NOT NULL,
  `searchText` text NOT NULL,
  `sceneSha256` varchar(64) DEFAULT NULL,
  `analysisVersion` varchar(16) NOT NULL DEFAULT 'legacy',
  `analysisGeneratedAt` timestamp NULL DEFAULT NULL,
  `sourceUpdatedAt` timestamp NULL DEFAULT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `video_scenes_video_shot_unique` (`videoId`, `shotIndex`),
  KEY `video_scenes_video_id_idx` (`videoId`),
  KEY `video_scenes_video_time_idx` (`videoId`, `startSec`),
  KEY `video_scenes_version_idx` (`analysisVersion`)
);
