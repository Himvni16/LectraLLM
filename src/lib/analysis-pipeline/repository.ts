import "server-only";

import { prisma } from "@/lib/prisma";
import { withPrismaRetry } from "@/lib/prisma-retry";
import type { AnalysisPipelineRepository } from "@/lib/analysis-pipeline/workflow";

export const prismaAnalysisPipelineRepository: AnalysisPipelineRepository = {
  async findById(id) {
    const analysis = await withPrismaRetry("analysis.findForPipeline", () =>
      prisma.analysis.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          transcriptText: true,
          pdfText: true,
          overallSimilarityScore: true,
          topics: { select: { id: true, source: true } },
          topicMatches: { select: { pdfTopicId: true } },
        },
      }),
    );
    return analysis
      ? {
          ...analysis,
          hasOverallSimilarityScore:
            analysis.overallSimilarityScore !== null,
        }
      : null;
  },

  async claimLease({
    id,
    expectedStatus,
    claimedStatus,
    token,
    now,
    expiresAt,
  }) {
    const result = await withPrismaRetry("analysis.claimPipelineLease", () =>
      prisma.analysis.updateMany({
        where: {
          id,
          status: expectedStatus,
          OR: [
            { processingToken: null },
            { processingExpiresAt: null },
            { processingExpiresAt: { lte: now } },
          ],
        },
        data: {
          status: claimedStatus,
          processingToken: token,
          processingExpiresAt: expiresAt,
        },
      }),
    );
    return result.count === 1;
  },

  async advanceWithLease(id, token, status, now) {
    const result = await withPrismaRetry("analysis.advancePipelineStage", () =>
      prisma.analysis.updateMany({
        where: {
          id,
          processingToken: token,
          processingExpiresAt: { gt: now },
        },
        data: {
          status,
          processingToken: null,
          processingExpiresAt: null,
        },
      }),
    );
    return result.count === 1;
  },

  async releaseLease(id, token) {
    const result = await withPrismaRetry(
      "analysis.releasePipelineLease",
      () =>
        prisma.analysis.updateMany({
          where: { id, processingToken: token },
          data: {
            processingToken: null,
            processingExpiresAt: null,
          },
        }),
    );
    return result.count === 1;
  },
};
