import { AnalysisStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { analysis: prismaMocks },
}));

import { prismaTranscriptionRepository } from "@/lib/transcription/repository";

describe("Prisma resumable transcription repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("persists provider state only for the live lease owner and an empty slot", async () => {
    await expect(
      prismaTranscriptionRepository.persistProviderFile(
        "analysis-1",
        "files/video-1",
        "lease-1",
      ),
    ).resolves.toBe(true);

    expect(prismaMocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "analysis-1",
        status: AnalysisStatus.TRANSCRIBING,
        transcriptionProviderFile: null,
        processingToken: "lease-1",
        processingExpiresAt: { gt: expect.any(Date) },
      },
      data: { transcriptionProviderFile: "files/video-1" },
    });
  });

  it("reports loss of ownership when a stale worker updates no rows", async () => {
    prismaMocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      prismaTranscriptionRepository.persistProviderFile(
        "analysis-1",
        "files/stale-video",
        "expired-lease",
      ),
    ).resolves.toBe(false);
  });

  it("clears only the expected provider file under matching ownership", async () => {
    await prismaTranscriptionRepository.clearProviderFile(
      "analysis-1",
      "files/video-1",
      "lease-1",
    );

    expect(prismaMocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "analysis-1",
        status: AnalysisStatus.TRANSCRIBING,
        transcriptionProviderFile: "files/video-1",
        processingToken: "lease-1",
        processingExpiresAt: { gt: expect.any(Date) },
      },
      data: { transcriptionProviderFile: null },
    });
  });

  it("atomically saves the transcript, clears provider state, and advances", async () => {
    await expect(
      prismaTranscriptionRepository.complete(
        "analysis-1",
        "files/video-1",
        "Transcript",
        "lease-1",
      ),
    ).resolves.toBe(true);

    expect(prismaMocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "analysis-1",
        status: AnalysisStatus.TRANSCRIBING,
        transcriptionProviderFile: "files/video-1",
        processingToken: "lease-1",
        processingExpiresAt: { gt: expect.any(Date) },
      },
      data: {
        transcriptText: "Transcript",
        transcriptionProviderFile: null,
        status: AnalysisStatus.EXTRACTING_PDF,
        processingToken: null,
        processingExpiresAt: null,
      },
    });
  });

  it("preserves reusable provider state on transient failure", async () => {
    await prismaTranscriptionRepository.fail("analysis-1", "lease-1", false);

    const data = prismaMocks.updateMany.mock.calls[0]?.[0].data;
    expect(data).toEqual({
      status: AnalysisStatus.FAILED,
      transcriptText: null,
      processingToken: null,
      processingExpiresAt: null,
    });
    expect(data).not.toHaveProperty("transcriptionProviderFile");
  });

  it("clears unusable provider state on permanent provider failure", async () => {
    await prismaTranscriptionRepository.fail("analysis-1", "lease-1", true);

    expect(prismaMocks.updateMany.mock.calls[0]?.[0].data).toEqual({
      status: AnalysisStatus.FAILED,
      transcriptText: null,
      transcriptionProviderFile: null,
      processingToken: null,
      processingExpiresAt: null,
    });
  });
});
