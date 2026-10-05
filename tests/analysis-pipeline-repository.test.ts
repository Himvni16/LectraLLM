import { AnalysisStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { analysis: prismaMocks },
}));

import { prismaAnalysisPipelineRepository } from "@/lib/analysis-pipeline/repository";

const now = new Date("2026-10-05T00:00:00.000Z");
const expiresAt = new Date("2026-10-05T00:10:00.000Z");

describe("Prisma analysis processing lease", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("atomically claims only an absent or expired lease", async () => {
    await expect(
      prismaAnalysisPipelineRepository.claimLease({
        id: "analysis-1",
        expectedStatus: AnalysisStatus.EXTRACTING_PDF,
        claimedStatus: AnalysisStatus.EXTRACTING_PDF,
        token: "lease-1",
        now,
        expiresAt,
      }),
    ).resolves.toBe(true);

    expect(prismaMocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "analysis-1",
        status: AnalysisStatus.EXTRACTING_PDF,
        OR: [
          { processingToken: null },
          { processingExpiresAt: null },
          { processingExpiresAt: { lte: now } },
        ],
      },
      data: {
        status: AnalysisStatus.EXTRACTING_PDF,
        processingToken: "lease-1",
        processingExpiresAt: expiresAt,
      },
    });
  });

  it("allows only one winner when concurrent claims race", async () => {
    prismaMocks.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const input = {
      id: "analysis-1",
      expectedStatus: AnalysisStatus.COMPARING,
      claimedStatus: AnalysisStatus.COMPARING,
      now,
      expiresAt,
    };

    await expect(
      prismaAnalysisPipelineRepository.claimLease({
        ...input,
        token: "lease-1",
      }),
    ).resolves.toBe(true);
    await expect(
      prismaAnalysisPipelineRepository.claimLease({
        ...input,
        token: "lease-2",
      }),
    ).resolves.toBe(false);
  });

  it("recovers an expired lease with a new owner token", async () => {
    await expect(
      prismaAnalysisPipelineRepository.claimLease({
        id: "analysis-1",
        expectedStatus: AnalysisStatus.TRANSCRIBING,
        claimedStatus: AnalysisStatus.UPLOADED,
        token: "recovery-lease",
        now,
        expiresAt,
      }),
    ).resolves.toBe(true);

    expect(prismaMocks.updateMany.mock.calls[0]?.[0].where.OR).toContainEqual({
      processingExpiresAt: { lte: now },
    });
  });

  it("rejects completion by an incorrect lease owner", async () => {
    prismaMocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      prismaAnalysisPipelineRepository.advanceWithLease(
        "analysis-1",
        "wrong-owner",
        AnalysisStatus.COMPLETED,
        now,
      ),
    ).resolves.toBe(false);
    expect(prismaMocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "analysis-1",
        processingToken: "wrong-owner",
        processingExpiresAt: { gt: now },
      },
      data: {
        status: AnalysisStatus.COMPLETED,
        processingToken: null,
        processingExpiresAt: null,
      },
    });
  });

  it("releases only the matching lease token", async () => {
    await expect(
      prismaAnalysisPipelineRepository.releaseLease("analysis-1", "lease-1"),
    ).resolves.toBe(true);
    expect(prismaMocks.updateMany).toHaveBeenCalledWith({
      where: { id: "analysis-1", processingToken: "lease-1" },
      data: { processingToken: null, processingExpiresAt: null },
    });
  });
});
