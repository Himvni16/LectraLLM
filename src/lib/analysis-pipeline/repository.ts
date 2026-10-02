import "server-only";

import { AnalysisStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { withPrismaRetry } from "@/lib/prisma-retry";
import type { AnalysisPipelineRepository } from "@/lib/analysis-pipeline/workflow";

export const prismaAnalysisPipelineRepository: AnalysisPipelineRepository = {
  findById(id) {
    return withPrismaRetry("analysis.findForPipeline", () =>
      prisma.analysis.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          transcriptText: true,
          pdfText: true,
          topics: { select: { source: true } },
        },
      }),
    );
  },

  async releaseInterruptedTranscription(id) {
    const result = await withPrismaRetry(
      "analysis.releaseInterruptedTranscription",
      () =>
        prisma.analysis.updateMany({
          where: { id, status: AnalysisStatus.TRANSCRIBING },
          data: { status: AnalysisStatus.FAILED },
        }),
    );

    return result.count === 1;
  },
};
