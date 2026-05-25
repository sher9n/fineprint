-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "name" TEXT,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL,
    "conditionId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "resolutionSource" TEXT,
    "endDate" TIMESTAMP(3),
    "startDate" TIMESTAMP(3),
    "liquidity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outcomes" TEXT NOT NULL,
    "outcomePrices" TEXT NOT NULL,
    "yesPrice" DOUBLE PRECISION,
    "noPrice" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "imageUrl" TEXT,
    "eventTitle" TEXT,
    "eventSlug" TEXT,
    "groupItemTitle" TEXT,
    "negRiskMarketId" TEXT,
    "rulesHash" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastIngestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "rulesHash" TEXT NOT NULL,
    "pass" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "vibeInterpretation" TEXT NOT NULL,
    "literalInterpretation" TEXT NOT NULL,
    "divergenceType" TEXT NOT NULL,
    "divergenceScore" INTEGER NOT NULL,
    "edgeDirection" TEXT NOT NULL,
    "ruleImpliedProbability" DOUBLE PRECISION,
    "expectedYesPayoutCents" DOUBLE PRECISION,
    "expectedNoPayoutCents" DOUBLE PRECISION,
    "verificationSteps" TEXT,
    "reasoning" TEXT NOT NULL,
    "sourceFindings" TEXT,
    "yesPriceAtAnalysis" DOUBLE PRECISION,
    "noPriceAtAnalysis" DOUBLE PRECISION,
    "liquidityAtAnalysis" DOUBLE PRECISION,
    "edgeScore" DOUBLE PRECISION NOT NULL,
    "betSide" TEXT NOT NULL DEFAULT 'NONE',
    "priceGap" DOUBLE PRECISION,
    "directionAgreement" BOOLEAN NOT NULL DEFAULT true,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheCreationTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "direction" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bet" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "marketId" TEXT NOT NULL,
    "analysisId" TEXT,
    "side" TEXT NOT NULL,
    "priceAtBet" DOUBLE PRECISION NOT NULL,
    "sizeUsd" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "pnlUsd" DOUBLE PRECISION,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Bet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "autoTradeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "batchModeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "firstPassModel" TEXT NOT NULL DEFAULT 'sonnet',
    "haikuConcurrency" INTEGER NOT NULL DEFAULT 5,
    "dailyBudgetUsd" DOUBLE PRECISION NOT NULL DEFAULT 20.0,
    "minDivergenceScore" INTEGER NOT NULL DEFAULT 6,
    "minLiquidityUsd" DOUBLE PRECISION NOT NULL DEFAULT 5000,
    "minDaysToEnd" INTEGER NOT NULL DEFAULT 2,
    "maxDaysToEnd" INTEGER NOT NULL DEFAULT 120,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchJob" (
    "id" TEXT NOT NULL,
    "anthropicBatchId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "purpose" TEXT NOT NULL DEFAULT 'first_pass',
    "marketIds" TEXT NOT NULL,
    "totalRequests" INTEGER NOT NULL,
    "succeededRequests" INTEGER NOT NULL DEFAULT 0,
    "failedRequests" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "errors" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "BatchJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostLog" (
    "id" TEXT NOT NULL,
    "dateIst" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheCreationTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ingest',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "marketsAdded" INTEGER NOT NULL DEFAULT 0,
    "marketsUpdated" INTEGER NOT NULL DEFAULT 0,
    "marketsAnalyzed" INTEGER NOT NULL DEFAULT 0,
    "haikuCalls" INTEGER NOT NULL DEFAULT 0,
    "opusCalls" INTEGER NOT NULL DEFAULT 0,
    "totalCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "errors" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',

    CONSTRAINT "IngestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Market_conditionId_key" ON "Market"("conditionId");

-- CreateIndex
CREATE INDEX "Market_endDate_idx" ON "Market"("endDate");

-- CreateIndex
CREATE INDEX "Market_liquidity_idx" ON "Market"("liquidity");

-- CreateIndex
CREATE INDEX "Market_active_closed_idx" ON "Market"("active", "closed");

-- CreateIndex
CREATE INDEX "Analysis_marketId_createdAt_idx" ON "Analysis"("marketId", "createdAt");

-- CreateIndex
CREATE INDEX "Analysis_edgeScore_idx" ON "Analysis"("edgeScore");

-- CreateIndex
CREATE INDEX "Analysis_divergenceScore_idx" ON "Analysis"("divergenceScore");

-- CreateIndex
CREATE INDEX "Vote_analysisId_idx" ON "Vote"("analysisId");

-- CreateIndex
CREATE INDEX "Vote_marketId_idx" ON "Vote"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_userId_marketId_key" ON "Vote"("userId", "marketId");

-- CreateIndex
CREATE INDEX "Bet_userId_placedAt_idx" ON "Bet"("userId", "placedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BatchJob_anthropicBatchId_key" ON "BatchJob"("anthropicBatchId");

-- CreateIndex
CREATE INDEX "BatchJob_status_idx" ON "BatchJob"("status");

-- CreateIndex
CREATE INDEX "CostLog_dateIst_idx" ON "CostLog"("dateIst");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analysis" ADD CONSTRAINT "Analysis_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bet" ADD CONSTRAINT "Bet_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;
