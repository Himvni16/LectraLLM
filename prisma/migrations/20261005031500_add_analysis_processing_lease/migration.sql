ALTER TABLE "Analysis"
ADD COLUMN "processingToken" TEXT,
ADD COLUMN "processingExpiresAt" TIMESTAMP(3);

CREATE INDEX "Analysis_processingExpiresAt_idx"
ON "Analysis"("processingExpiresAt");
