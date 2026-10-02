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

  async claim(id) {
    const result = await withPrismaRetry("analysis.claimPdfExtraction", () =>
      prisma.analysis.updateMany({
        where: {
          id,
          status: { in: [AnalysisStatus.EXTRACTING_PDF, AnalysisStatus.FAILED] },
          transcriptText: { not: null },
        },
        data: {
          status: AnalysisStatus.EXTRACTING_PDF,
          pdfText: null,
        },
      }),
    );

    return result.count === 1;
  },

  async complete(id, pdfText) {
    const result = await withPrismaRetry("analysis.completePdfExtraction", () =>
      prisma.analysis.updateMany({
        where: { id, status: AnalysisStatus.EXTRACTING_PDF },
        data: {
          pdfText,
          status: AnalysisStatus.EXTRACTING_TOPICS,
        },
      }),
    );

    return result.count === 1;
  },

  async fail(id) {
    await withPrismaRetry("analysis.failPdfExtraction", () =>
      prisma.analysis.updateMany({
        where: {
          id,
          status: {
            in: [AnalysisStatus.EXTRACTING_PDF, AnalysisStatus.FAILED],
          },
          transcriptText: { not: null },
        },
        data: {
          status: AnalysisStatus.FAILED,
          pdfText: null,
        },
      }),
    );
  },
};
