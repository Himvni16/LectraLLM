import "server-only";

import { AnalysisStatus } from "@prisma/client";

import type { PdfExtractionRepository } from "@/lib/pdf-extraction/types";
import { prisma } from "@/lib/prisma";
import { withPrismaRetry } from "@/lib/prisma-retry";

export const prismaPdfExtractionRepository: PdfExtractionRepository = {
  findById(id) {
    return withPrismaRetry("analysis.findForPdfExtraction", () =>
      prisma.analysis.findUnique({
        where: { id },
        select: {
          id: true,
          videoFileName: true,
          pdfFileName: true,
          pdfStoragePath: true,
          status: true,
          transcriptText: true,
          pdfText: true,
        },
      }),
    );
  },

  async claim(id, leaseToken) {
    const result = await withPrismaRetry("analysis.claimPdfExtraction", () =>
      prisma.analysis.updateMany({
        where: {
          id,
          status: { in: [AnalysisStatus.EXTRACTING_PDF, AnalysisStatus.FAILED] },
          transcriptText: { not: null },
          processingToken: leaseToken,
          processingExpiresAt: { gt: new Date() },
        },
        data: {
          status: AnalysisStatus.EXTRACTING_PDF,
          pdfText: null,
        },
      }),
    );

    return result.count === 1;
  },

  async complete(id, pdfText, leaseToken) {
    const result = await withPrismaRetry("analysis.completePdfExtraction", () =>
      prisma.analysis.updateMany({
        where: {
          id,
          status: AnalysisStatus.EXTRACTING_PDF,
          processingToken: leaseToken,
          processingExpiresAt: { gt: new Date() },
        },
        data: {
          pdfText,
          status: AnalysisStatus.EXTRACTING_TOPICS,
          processingToken: null,
          processingExpiresAt: null,
        },
      }),
    );

    return result.count === 1;
  },

  async fail(id, leaseToken) {
    await withPrismaRetry("analysis.failPdfExtraction", () =>
      prisma.analysis.updateMany({
        where: {
          id,
          status: {
            in: [AnalysisStatus.EXTRACTING_PDF, AnalysisStatus.FAILED],
          },
          transcriptText: { not: null },
          processingToken: leaseToken,
          processingExpiresAt: { gt: new Date() },
        },
        data: {
          status: AnalysisStatus.FAILED,
          pdfText: null,
          processingToken: null,
          processingExpiresAt: null,
        },
      }),
    );
  },
};
