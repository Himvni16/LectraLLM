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

  async claim(id, leaseToken) {
    const result = await withPrismaRetry("analysis.claimTranscription", () =>
      prisma.analysis.updateMany({
        where: {
          id,
          status: { in: [AnalysisStatus.UPLOADED, AnalysisStatus.FAILED] },
          processingToken: leaseToken,
          processingExpiresAt: { gt: new Date() },
        },
        data: {
          status: AnalysisStatus.TRANSCRIBING,
          transcriptText: null,
        },
      }),
    );

    return result.count === 1;
  },

  async complete(id, transcriptText, leaseToken) {
    const result = await withPrismaRetry("analysis.completeTranscription", () =>
      prisma.analysis.updateMany({
        where: {
          id,
          status: AnalysisStatus.TRANSCRIBING,
          processingToken: leaseToken,
          processingExpiresAt: { gt: new Date() },
        },
        data: {
          transcriptText,
          status: AnalysisStatus.EXTRACTING_PDF,
          processingToken: null,
          processingExpiresAt: null,
        },
      }),
    );

    return result.count === 1;
  },

  async fail(id, leaseToken) {
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
          processingToken: leaseToken,
          processingExpiresAt: { gt: new Date() },
        },
        data: {
          status: AnalysisStatus.FAILED,
          transcriptText: null,
          processingToken: null,
          processingExpiresAt: null,
        },
      }),
    );
  },
};
