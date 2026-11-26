-- Idempotent migration DDL for analysis version tracking & archive history (TiDB Cloud Serverless / MySQL 8)
-- Aligned with chibatmute's v3 write procedure and PILOT_V3_REPORT.md Ch. 5.
--
-- DO NOT EXECUTE WITHOUT USER APPROVAL AND ACTIVE `_apply_lock.json`.
-- Existing videos and scenes default to analysisVersion = 'legacy'.
-- Differences between v3 and v3.1 (prompt revisions) are distinguished via `analysisPromptSha256`.

-- 1. Add analysis version metadata columns to `videos`
ALTER TABLE `videos`
  ADD COLUMN IF NOT EXISTS `analysisVersion` varchar(16) NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS `analysisGeneratedAt` timestamp NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `analysisPromptSha256` varchar(64) NULL DEFAULT NULL;

-- 2. Archive table preserving previous `aiAnalysis` snapshots before v3 replacement
-- Aligned with docs/sql/proposed_v3_analysis_ddl.sql (D-026 / chibatmute).
CREATE TABLE IF NOT EXISTS `videoAnalysisHistory` (
  `id` int AUTO_INCREMENT NOT NULL,
  `videoId` varchar(64) NOT NULL,
  `analysisVersion` varchar(16) NOT NULL,
  `aiAnalysis` mediumtext NULL,
  `contentSha256` varchar(64) NOT NULL,
  `promptSha256` varchar(64) NULL DEFAULT NULL,
  `generatedAt` timestamp NULL DEFAULT NULL,
  `archivedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `archivedBy` varchar(64) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `video_analysis_history_video_id_idx` (`videoId`, `archivedAt`),
  KEY `video_analysis_history_version_idx` (`analysisVersion`)
);

-- 3. `videoScenes` already includes `analysisVersion` (default 'legacy') and `analysisGeneratedAt`
--    in `drizzle/create_video_scenes.sql`. If `videoScenes` was created before those columns were added,
--    apply the following idempotent statements as well:
-- ALTER TABLE `videoScenes`
--   ADD COLUMN IF NOT EXISTS `analysisVersion` varchar(16) NOT NULL DEFAULT 'legacy',
--   ADD COLUMN IF NOT EXISTS `analysisGeneratedAt` timestamp NULL DEFAULT NULL;
