import "server-only";

import { prisma } from "@/lib/prisma";
import { withPrismaRetry } from "@/lib/prisma-retry";
import type { AnalysisRepository } from "@/lib/uploads/types";

export const prismaAnalysisRepository: AnalysisRepository = {
  createUploaded(data) {
    return withPrismaRetry("analysis.create", () =>
      prisma.analysis.create({
        data,
        select: {
          id: true,
          status: true,
          videoFileName: true,
          pdfFileName: true,
        },
      }),
    );
  },
};
