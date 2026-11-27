-- Idempotent migration DDL for original video publication timestamp (TiDB Cloud Serverless / MySQL 8)
--
-- DO NOT EXECUTE WITHOUT USER APPROVAL AND ACTIVE `analysis/claims/_apply_lock.json`.
-- Execution owner: CHIBA-PC2 ONLY.
--
-- Adds nullable DATETIME column `publishedAt` (UTC) to `videos`.
-- Populated from:
--   - YouTube Data API v3 (`videos.list?part=snippet,status` -> `snippet.publishedAt`, 50 IDs/request)
--   - Vimeo oEmbed (`https://vimeo.com/api/oembed.json?url=...` -> `upload_date`, <= 1 req/sec)
-- NEVER uses yt-dlp or cookies.
--
-- Existing 40 Pre-D original columns, legacy score columns, and `updatedAt` are NOT modified or dropped.
-- Code that SELECTs `videos.publishedAt` MUST be merged ONLY AFTER this DDL has been applied to TiDB.

ALTER TABLE `videos`
  ADD COLUMN IF NOT EXISTS `publishedAt` DATETIME NULL;
