-- Revert DeepResearchJob to the Responses API (background mode) shape. Batch API access for
-- the o3-deep-research model isn't available on the current OpenAI org, and the user opted to
-- stay on direct Responses calls for deep research (Anthropic batching unchanged for everything
-- else). Existing rows cleared above the migration.

DROP INDEX "DeepResearchJob_openaiBatchId_key";

ALTER TABLE "DeepResearchJob"
  DROP COLUMN "openaiBatchId",
  DROP COLUMN "openaiInputFileId",
  DROP COLUMN "openaiOutputFileId",
  ADD COLUMN  "openaiResponseId" TEXT NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'queued';

CREATE UNIQUE INDEX "DeepResearchJob_openaiResponseId_key" ON "DeepResearchJob"("openaiResponseId");
