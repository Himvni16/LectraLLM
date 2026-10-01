import "server-only";

import { prisma } from "@/lib/prisma";
import type { AnalysisRepository } from "@/lib/uploads/types";

export const prismaAnalysisRepository: AnalysisRepository = {
  createUploaded(data) {
    return prisma.analysis.create({
      data,
      select: {
        id: true,
        status: true,
        videoFileName: true,
        pdfFileName: true,
      },
    });
  },
};
