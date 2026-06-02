-- Retire the vestigial batchModeEnabled flag. The opus-first daily pipeline (2026-05-29) does not
-- consult it, the legacy haiku->opus escalation poll it gated is removed, and the manual Analyze /
-- Run-daily actions now always run the daily Opus passes. Dropping the column is metadata-only.
ALTER TABLE "Settings" DROP COLUMN "batchModeEnabled";
