-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('UPLOADED', 'TRANSCRIBING', 'EXTRACTING_PDF', 'EXTRACTING_TOPICS', 'COMPARING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "TopicSource" AS ENUM ('VIDEO', 'PDF');

-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('STRONG', 'PARTIAL', 'WEAK', 'MISSING');

-- CreateTable
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "videoFileName" TEXT NOT NULL,
    "pdfFileName" TEXT NOT NULL,
    "videoStoragePath" TEXT NOT NULL,
    "pdfStoragePath" TEXT NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'UPLOADED',
    "transcriptText" TEXT,
    "pdfText" TEXT,
    "overallSimilarityScore" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" "TopicSource" NOT NULL,
    "confidenceScore" DECIMAL(5,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicMatch" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "videoTopicId" TEXT NOT NULL,
    "pdfTopicId" TEXT NOT NULL,
    "similarityScore" DECIMAL(5,4) NOT NULL,
    "matchType" "MatchType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TopicMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Analysis_status_idx" ON "Analysis"("status");

-- CreateIndex
CREATE INDEX "Topic_analysisId_idx" ON "Topic"("analysisId");

-- CreateIndex
CREATE INDEX "Topic_source_idx" ON "Topic"("source");

-- CreateIndex
CREATE INDEX "TopicMatch_analysisId_idx" ON "TopicMatch"("analysisId");

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicMatch" ADD CONSTRAINT "TopicMatch_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "Analysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicMatch" ADD CONSTRAINT "TopicMatch_videoTopicId_fkey" FOREIGN KEY ("videoTopicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicMatch" ADD CONSTRAINT "TopicMatch_pdfTopicId_fkey" FOREIGN KEY ("pdfTopicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
