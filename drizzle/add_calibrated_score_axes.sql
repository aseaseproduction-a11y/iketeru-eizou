-- Idempotent migration DDL for per-axis calibrated scores (TiDB Cloud Serverless / MySQL 8)
--
-- DO NOT EXECUTE WITHOUT USER APPROVAL AND ACTIVE `analysis/claims/_apply_lock.json`.
-- Execution owner: CHIBA-PC2 ONLY.
--
-- Adds nullable JSON column `calibratedScoreAxes` to `videos`.
-- Example payload:
--   {
--     "v": 1,
--     "axes": {
--       "direction": 17,
--       "visual_craft": 16,
--       "editing_rhythm": 17.5,
--       "sound_integration": 17,
--       "originality_finish": 16
--     },
--     "runs": 2,
--     "source": "phase3",
--     "offsetPerAxis": 0
--   }
-- For Gemini API URL runs (`source: "api"` with -2.25 bias correction), `offsetPerAxis` is 0.45.
--
-- Legacy score columns (`aiOverallScore`, `aiDirectionScore`, `aiTechniqueScore`,
-- `aiOverallRating`, `aiDirectionRating`, `aiTechniqueRating`, `aiScoreBreakdown`)
-- and all 40 Pre-D original columns are NOT modified or dropped.

ALTER TABLE `videos`
  ADD COLUMN IF NOT EXISTS `calibratedScoreAxes` JSON NULL;
