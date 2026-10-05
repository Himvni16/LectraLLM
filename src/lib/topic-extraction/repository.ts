import "server-only";

import { AnalysisStatus, TopicSource } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { withPrismaRetry } from "@/lib/prisma-retry";
import type {
  ExtractedTopic,
  TopicExtractionRepository,
} from "@/lib/topic-extraction/types";

function topicRows(
  analysisId: string,
  source: TopicSource,
  topics: readonly ExtractedTopic[],
) {
  return topics.map((topic) => ({
    analysisId,
    source,
    name: topic.name,
    confidenceScore: topic.confidence,
  }));
}

export const prismaTopicExtractionRepository: TopicExtractionRepository = {
  findById(id) {
    return withPrismaRetry("analysis.findForTopicExtraction", () =>
      prisma.analysis.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          transcriptText: true,
          pdfText: true,
        },
      }),
    );
  },

  async claim(id, leaseToken) {
    const result = await withPrismaRetry("analysis.claimTopicExtraction", () =>
      prisma.analysis.updateMany({
        where: {
          id,
          status: {
            in: [AnalysisStatus.EXTRACTING_TOPICS, AnalysisStatus.FAILED],
          },
          transcriptText: { not: null },
          pdfText: { not: null },
          processingToken: leaseToken,
          processingExpiresAt: { gt: new Date() },
        },
        data: { status: AnalysisStatus.EXTRACTING_TOPICS },
      }),
    );

    return result.count === 1;
  },

  replaceAndComplete(id, videoTopics, pdfTopics, leaseToken) {
    return withPrismaRetry("analysis.replaceTopics", () =>
      prisma.$transaction(async (transaction) => {
        const transition = await transaction.analysis.updateMany({
          where: {
            id,
            status: AnalysisStatus.EXTRACTING_TOPICS,
            processingToken: leaseToken,
            processingExpiresAt: { gt: new Date() },
          },
          data: {
            status: AnalysisStatus.COMPARING,
            processingToken: null,
            processingExpiresAt: null,
          },
        });

        if (transition.count !== 1) {
          return false;
        }

        await transaction.topic.deleteMany({ where: { analysisId: id } });

        const rows = [
          ...topicRows(id, TopicSource.VIDEO, videoTopics),
          ...topicRows(id, TopicSource.PDF, pdfTopics),
        ];

        if (rows.length > 0) {
          await transaction.topic.createMany({ data: rows });
        }

        return true;
      }),
    );
  },

  async fail(id, leaseToken) {
    await withPrismaRetry("analysis.failTopicExtraction", () =>
      prisma.analysis.updateMany({
        where: {
          id,
          status: AnalysisStatus.EXTRACTING_TOPICS,
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
