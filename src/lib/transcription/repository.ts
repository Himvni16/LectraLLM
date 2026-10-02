import "server-only";

import { AnalysisStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { withPrismaRetry } from "@/lib/prisma-retry";
import type { TranscriptionRepository } from "@/lib/transcription/types";

export const prismaTranscriptionRepository: TranscriptionRepository = {
  findById(id) {
    return withPrismaRetry("analysis.findForTranscription", () =>
      prisma.analysis.findUnique({
        where: { id },
        select: {
          id: true,
          videoFileName: true,
          pdfFileName: true,
          videoStoragePath: true,
          status: true,
          transcriptText: true,
        },
      }),
    );
  },

  async claim(id) {
    const result = await withPrismaRetry("analysis.claimTranscription", () =>
      prisma.analysis.updateMany({
        where: {
          id,
          status: { in: [AnalysisStatus.UPLOADED, AnalysisStatus.FAILED] },
        },
        data: {
          status: AnalysisStatus.TRANSCRIBING,
          transcriptText: null,
        },
      }),
    );

    return result.count === 1;
  },

  async complete(id, transcriptText) {
    const result = await withPrismaRetry("analysis.completeTranscription", () =>
      prisma.analysis.updateMany({
        where: { id, status: AnalysisStatus.TRANSCRIBING },
        data: {
          transcriptText,
          status: AnalysisStatus.EXTRACTING_PDF,
        },
      }),
    );

    return result.count === 1;
  },

  async fail(id) {
    await withPrismaRetry("analysis.failTranscription", () =>
      prisma.analysis.updateMany({
        where: {
          id,
          status: {
            in: [
              AnalysisStatus.UPLOADED,
              AnalysisStatus.TRANSCRIBING,
              AnalysisStatus.FAILED,
            ],
          },
        },
        data: {
          status: AnalysisStatus.FAILED,
          transcriptText: null,
        },
      }),
    );
  },
};
