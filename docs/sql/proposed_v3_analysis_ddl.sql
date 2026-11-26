-- Proposed TiDB DDL for Analysis v3 Version Tracking & History (D-026)
-- STATUS: DRAFT PROPOSAL ONLY — DO NOT EXECUTE WITHOUT EXPLICIT USER APPROVAL.
-- Shared column specification aligned with CHIBA-PC2 (site/Drizzle owner).

-- 1. videos table: add 3 version-tracking columns
ALTER TABLE `videos`
  ADD COLUMN `analysisVersion` VARCHAR(16) NOT NULL DEFAULT 'legacy',
  ADD COLUMN `analysisGeneratedAt` TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN `analysisPromptSha256` VARCHAR(64) NULL DEFAULT NULL;

-- 2. videoAnalysisHistory table: archive previous aiAnalysis before each v3 overwrite
CREATE TABLE IF NOT EXISTS `videoAnalysisHistory` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `videoId` VARCHAR(64) NOT NULL,
  `analysisVersion` VARCHAR(16) NOT NULL,
  `aiAnalysis` MEDIUMTEXT NULL,
  `contentSha256` VARCHAR(64) NOT NULL,
  `promptSha256` VARCHAR(64) NULL DEFAULT NULL,
  `generatedAt` TIMESTAMP NULL DEFAULT NULL,
  `archivedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `archivedBy` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_video_analysis_history_video_id` (`videoId`),
  INDEX `idx_video_analysis_history_archived_at` (`archivedAt`)
);

-- 3. videoScenes table (created by CHIBA-PC2): add 2 version-tracking columns
-- (Run only after CHIBA-PC2 creates `videoScenes`, or include directly in CHIBA-PC2's CREATE TABLE)
ALTER TABLE `videoScenes`
  ADD COLUMN `analysisVersion` VARCHAR(16) NOT NULL DEFAULT 'legacy',
  ADD COLUMN `analysisGeneratedAt` TIMESTAMP NULL DEFAULT NULL;
