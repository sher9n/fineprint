-- Switch DeepResearchJob from the Responses background-mode shape to the Batch API shape.
-- The Responses API stored a single response id; the Batch API uses a batch id plus input/output
-- file ids. Existing DeepResearchJob rows have already been cleared above the migration.

DROP INDEX "DeepResearchJob_openaiResponseId_key";

ALTER TABLE "DeepResearchJob"
  DROP COLUMN "openaiResponseId",
  ADD COLUMN  "openaiBatchId" TEXT NOT NULL,
  ADD COLUMN  "openaiInputFileId" TEXT,
  ADD COLUMN  "openaiOutputFileId" TEXT,
  ALTER COLUMN "status" SET DEFAULT 'validating';

CREATE UNIQUE INDEX "DeepResearchJob_openaiBatchId_key" ON "DeepResearchJob"("openaiBatchId");
