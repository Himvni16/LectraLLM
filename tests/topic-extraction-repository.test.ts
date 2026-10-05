import { AnalysisStatus, TopicSource } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => {
  const transaction = {
    analysis: { updateMany: vi.fn() },
    topic: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    topicMatch: { createMany: vi.fn() },
  };

  return {
    analysis: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
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

import { prismaTopicExtractionRepository } from "@/lib/topic-extraction/repository";

describe("Prisma topic extraction repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.analysis.updateMany.mockResolvedValue({ count: 1 });
    prismaMocks.transaction.analysis.updateMany.mockResolvedValue({ count: 1 });
    prismaMocks.transaction.topic.deleteMany.mockResolvedValue({ count: 2 });
    prismaMocks.transaction.topic.createMany.mockResolvedValue({ count: 2 });
  });

  it("persists VIDEO and PDF topics and advances status atomically", async () => {
    await expect(
      prismaTopicExtractionRepository.replaceAndComplete(
        "analysis-1",
        [{ name: "Deadlocks", confidence: 0.94 }],
        [{ name: "Deadlock Prevention", confidence: 0.9 }],
        "lease-1",
      ),
    ).resolves.toBe(true);

    expect(prismaMocks.runTransaction).toHaveBeenCalledTimes(1);
    expect(prismaMocks.transaction.analysis.updateMany).toHaveBeenCalledWith({
      where: {
        id: "analysis-1",
        status: AnalysisStatus.EXTRACTING_TOPICS,
        processingToken: "lease-1",
        processingExpiresAt: { gt: expect.any(Date) },
      },
      data: {
        status: AnalysisStatus.COMPARING,
        processingToken: null,
        processingExpiresAt: null,
      },
    });
    expect(prismaMocks.transaction.topic.deleteMany).toHaveBeenCalledWith({
      where: { analysisId: "analysis-1" },
    });
    expect(prismaMocks.transaction.topic.createMany).toHaveBeenCalledWith({
      data: [
        {
          analysisId: "analysis-1",
          source: TopicSource.VIDEO,
          name: "Deadlocks",
          confidenceScore: 0.94,
        },
        {
          analysisId: "analysis-1",
          source: TopicSource.PDF,
          name: "Deadlock Prevention",
          confidenceScore: 0.9,
        },
      ],
    });
    expect(prismaMocks.transaction.topicMatch.createMany).not.toHaveBeenCalled();
  });

  it("replaces only topics belonging to the current analysis", async () => {
    await prismaTopicExtractionRepository.replaceAndComplete(
      "analysis-2",
      [],
      [],
      "lease-1",
    );

    expect(prismaMocks.transaction.topic.deleteMany).toHaveBeenCalledWith({
      where: { analysisId: "analysis-2" },
    });
    expect(prismaMocks.transaction.topic.createMany).not.toHaveBeenCalled();
  });

  it("does not replace topics when the completion transition loses its race", async () => {
    prismaMocks.transaction.analysis.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      prismaTopicExtractionRepository.replaceAndComplete(
        "analysis-1",
        [{ name: "Deadlocks", confidence: null }],
        [],
        "lease-1",
      ),
    ).resolves.toBe(false);

    expect(prismaMocks.transaction.topic.deleteMany).not.toHaveBeenCalled();
    expect(prismaMocks.transaction.topic.createMany).not.toHaveBeenCalled();
  });

  it("marks failure without changing source text or existing topics", async () => {
    await prismaTopicExtractionRepository.fail("analysis-1", "lease-1");

    expect(prismaMocks.analysis.updateMany).toHaveBeenCalledWith({
      where: {
        id: "analysis-1",
        status: AnalysisStatus.EXTRACTING_TOPICS,
        processingToken: "lease-1",
        processingExpiresAt: { gt: expect.any(Date) },
      },
      data: {
        status: AnalysisStatus.FAILED,
        processingToken: null,
        processingExpiresAt: null,
      },
    });
    const call = prismaMocks.analysis.updateMany.mock.calls[0]?.[0];
    expect(call.data).not.toHaveProperty("transcriptText");
    expect(call.data).not.toHaveProperty("pdfText");
    expect(prismaMocks.transaction.topic.deleteMany).not.toHaveBeenCalled();
  });
});
