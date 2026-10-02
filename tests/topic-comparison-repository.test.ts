import { AnalysisStatus, MatchType, Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => {
  const transaction = {
    analysis: { updateMany: vi.fn() },
    topicMatch: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
  return {
    analysis: { findUnique: vi.fn(), updateMany: vi.fn() },
    transaction,
    runTransaction: vi.fn(
      async (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
    ),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    analysis: prismaMocks.analysis,
    $transaction: prismaMocks.runTransaction,
  },
}));

import { prismaTopicComparisonRepository } from "@/lib/topic-comparison/repository";

const matches = [
  {
    pdfTopicId: "pdf-1",
    videoTopicId: "video-1",
    similarityScore: 0.81,
    matchType: MatchType.STRONG,
  },
  {
    pdfTopicId: "pdf-2",
    videoTopicId: null,
    similarityScore: 0.12,
    matchType: MatchType.MISSING,
  },
];

describe("Prisma topic comparison repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.analysis.updateMany.mockResolvedValue({ count: 1 });
    prismaMocks.transaction.analysis.updateMany.mockResolvedValue({ count: 1 });
    prismaMocks.transaction.topicMatch.deleteMany.mockResolvedValue({ count: 2 });
    prismaMocks.transaction.topicMatch.createMany.mockResolvedValue({ count: 2 });
  });

  it("replaces old matches and completes atomically", async () => {
    const overallScore = new Prisma.Decimal("46.5");

    await expect(
      prismaTopicComparisonRepository.replaceAndComplete(
        "analysis-1",
        matches,
        overallScore,
      ),
    ).resolves.toBe(true);

    expect(prismaMocks.runTransaction).toHaveBeenCalledTimes(1);
    expect(prismaMocks.transaction.analysis.updateMany).toHaveBeenCalledWith({
      where: { id: "analysis-1", status: AnalysisStatus.COMPARING },
      data: {
        status: AnalysisStatus.COMPLETED,
        overallSimilarityScore: overallScore,
      },
    });
    expect(prismaMocks.transaction.topicMatch.deleteMany).toHaveBeenCalledWith({
      where: { analysisId: "analysis-1" },
    });
    expect(prismaMocks.transaction.topicMatch.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          analysisId: "analysis-1",
          pdfTopicId: "pdf-1",
          videoTopicId: "video-1",
          matchType: MatchType.STRONG,
        }),
        expect.objectContaining({
          analysisId: "analysis-1",
          pdfTopicId: "pdf-2",
          videoTopicId: null,
          matchType: MatchType.MISSING,
        }),
      ],
    });
  });

  it("does not replace matches when the completion transition loses its race", async () => {
    prismaMocks.transaction.analysis.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      prismaTopicComparisonRepository.replaceAndComplete(
        "analysis-1",
        matches,
        new Prisma.Decimal(50),
      ),
    ).resolves.toBe(false);
    expect(prismaMocks.transaction.topicMatch.deleteMany).not.toHaveBeenCalled();
    expect(prismaMocks.transaction.topicMatch.createMany).not.toHaveBeenCalled();
  });

  it("marks only an in-progress comparison as FAILED", async () => {
    await prismaTopicComparisonRepository.fail("analysis-1");

    expect(prismaMocks.analysis.updateMany).toHaveBeenCalledWith({
      where: { id: "analysis-1", status: AnalysisStatus.COMPARING },
      data: { status: AnalysisStatus.FAILED },
    });
  });
});
