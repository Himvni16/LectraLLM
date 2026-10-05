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
          transcriptionProviderFile: true,
        },
      }),
    );
  },

  async claim(id, leaseToken) {
    const result = await withPrismaRetry("analysis.claimTranscription", () =>
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
          status: AnalysisStatus.TRANSCRIBING,
        },
      }),
    );

    return result.count === 1;
  },

  async persistProviderFile(id, providerFile, leaseToken) {
    const result = await withPrismaRetry(
      "analysis.persistTranscriptionProviderFile",
      () =>
        prisma.analysis.updateMany({
          where: {
            id,
            status: AnalysisStatus.TRANSCRIBING,
            transcriptionProviderFile: null,
            processingToken: leaseToken,
            processingExpiresAt: { gt: new Date() },
          },
          data: { transcriptionProviderFile: providerFile },
        }),
    );
    return result.count === 1;
  },

  async clearProviderFile(id, providerFile, leaseToken) {
    const result = await withPrismaRetry(
      "analysis.clearTranscriptionProviderFile",
      () =>
        prisma.analysis.updateMany({
          where: {
            id,
            status: AnalysisStatus.TRANSCRIBING,
            transcriptionProviderFile: providerFile,
            processingToken: leaseToken,
            processingExpiresAt: { gt: new Date() },
          },
          data: { transcriptionProviderFile: null },
        }),
    );
    return result.count === 1;
  },

  async complete(id, providerFile, transcriptText, leaseToken) {
    const result = await withPrismaRetry("analysis.completeTranscription", () =>
      prisma.analysis.updateMany({
        where: {
          id,
          status: AnalysisStatus.TRANSCRIBING,
          transcriptionProviderFile: providerFile,
          processingToken: leaseToken,
          processingExpiresAt: { gt: new Date() },
        },
        data: {
          transcriptText,
          transcriptionProviderFile: null,
          status: AnalysisStatus.EXTRACTING_PDF,
          processingToken: null,
          processingExpiresAt: null,
        },
      }),
    );

    return result.count === 1;
  },

  async fail(id, leaseToken, clearProviderFile) {
    const result = await withPrismaRetry("analysis.failTranscription", () =>
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
          ...(clearProviderFile ? { transcriptionProviderFile: null } : {}),
          processingToken: null,
          processingExpiresAt: null,
        },
      }),
    );
    return result.count === 1;
  },
};
