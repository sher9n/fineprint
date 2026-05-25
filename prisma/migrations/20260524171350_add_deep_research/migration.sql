-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "dailyDeepResearchBudgetUsd" DOUBLE PRECISION NOT NULL DEFAULT 50.0,
ADD COLUMN     "deepResearchAutoEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "DeepResearchJob" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "openaiResponseId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "rulesHashAtSubmit" TEXT NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPolledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DeepResearchJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeepResearchJob_openaiResponseId_key" ON "DeepResearchJob"("openaiResponseId");

-- CreateIndex
CREATE INDEX "DeepResearchJob_status_idx" ON "DeepResearchJob"("status");

-- CreateIndex
CREATE INDEX "DeepResearchJob_marketId_submittedAt_idx" ON "DeepResearchJob"("marketId", "submittedAt");

-- AddForeignKey
ALTER TABLE "DeepResearchJob" ADD CONSTRAINT "DeepResearchJob_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;
