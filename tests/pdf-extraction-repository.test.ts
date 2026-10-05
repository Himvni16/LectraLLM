import { AnalysisStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    analysis: prismaMocks,
  },
}));

import { prismaPdfExtractionRepository } from "@/lib/pdf-extraction/repository";

describe("Prisma PDF extraction repository", () => {
  beforeEach(() => {
    prismaMocks.updateMany.mockReset();
    prismaMocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("persists PDF text without changing transcriptText", async () => {
    await prismaPdfExtractionRepository.complete(
      "analysis-1",
      "Extracted lecture notes",
      "lease-1",
    );

    const call = prismaMocks.updateMany.mock.calls[0]?.[0];
    expect(call).toEqual({
      where: {
        id: "analysis-1",
        status: AnalysisStatus.EXTRACTING_PDF,
        processingToken: "lease-1",
        processingExpiresAt: { gt: expect.any(Date) },
      },
      data: {
        pdfText: "Extracted lecture notes",
        status: AnalysisStatus.EXTRACTING_TOPICS,
        processingToken: null,
        processingExpiresAt: null,
      },
    });
    expect(call.data).not.toHaveProperty("transcriptText");
  });

  it("marks extraction failed without changing transcriptText", async () => {
    await prismaPdfExtractionRepository.fail("analysis-1", "lease-1");

    const call = prismaMocks.updateMany.mock.calls[0]?.[0];
    expect(call.data).toEqual({
      status: AnalysisStatus.FAILED,
      pdfText: null,
      processingToken: null,
      processingExpiresAt: null,
    });
    expect(call.data).not.toHaveProperty("transcriptText");
  });
});
