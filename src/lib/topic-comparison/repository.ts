import "server-only";

import { AnalysisStatus, Prisma, TopicSource } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { withPrismaRetry } from "@/lib/prisma-retry";
import type { TopicComparisonRepository } from "@/lib/topic-comparison/types";

export const prismaTopicComparisonRepository: TopicComparisonRepository = {
  findById(id) {
    return withPrismaRetry("analysis.findForTopicComparison", () =>
      prisma.analysis.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          topics: {
            select: { id: true, name: true, source: true },
            orderBy: { createdAt: "asc" },
          },
        },
      }),
    );
  },

  async claim(id, leaseToken) {
    const result = await withPrismaRetry("analysis.claimTopicComparison", () =>
      prisma.analysis.updateMany({
        where: {
          id,
          status: { in: [AnalysisStatus.COMPARING, AnalysisStatus.FAILED] },
          topics: { some: { source: TopicSource.VIDEO } },
          AND: { topics: { some: { source: TopicSource.PDF } } },
          processingToken: leaseToken,
          processingExpiresAt: { gt: new Date() },
        },
        data: { status: AnalysisStatus.COMPARING },
      }),
    );

    return result.count === 1;
  },

  replaceAndComplete(id, matches, overallSimilarityScore, leaseToken) {
    return withPrismaRetry("analysis.replaceTopicComparison", () =>
      prisma.$transaction(async (transaction) => {
        const transition = await transaction.analysis.updateMany({
          where: {
            id,
            status: AnalysisStatus.COMPARING,
            processingToken: leaseToken,
            processingExpiresAt: { gt: new Date() },
          },
          data: {
            status: AnalysisStatus.COMPLETED,
            overallSimilarityScore,
            processingToken: null,
            processingExpiresAt: null,
          },
        });

        if (transition.count !== 1) return false;

        await transaction.topicMatch.deleteMany({
          where: { analysisId: id },
        });

        if (matches.length > 0) {
          await transaction.topicMatch.createMany({
            data: matches.map((match) => ({
              analysisId: id,
              pdfTopicId: match.pdfTopicId,
              videoTopicId: match.videoTopicId,
              similarityScore: new Prisma.Decimal(
                match.similarityScore.toString(),
              ),
              matchType: match.matchType,
            })),
          });
        }

        return true;
      }),
    );
  },

  async fail(id, leaseToken) {
    await withPrismaRetry("analysis.failTopicComparison", () =>
      prisma.analysis.updateMany({
        where: {
          id,
          status: AnalysisStatus.COMPARING,
          processingToken: leaseToken,
          processingExpiresAt: { gt: new Date() },
        },
        data: {
          status: AnalysisStatus.FAILED,
          processingToken: null,
          processingExpiresAt: null,
        },
      }),
    );
  },
};
