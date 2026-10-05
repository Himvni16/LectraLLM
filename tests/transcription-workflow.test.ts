import { AnalysisStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { StoredVideoUnavailableError } from "@/lib/transcription/media";
import type {
  AiTranscriptionResult,
  TranscriptionAnalysis,
  TranscriptionClient,
  TranscriptionRepository,
  VideoLocator,
} from "@/lib/transcription/types";
import {
  transcribeAnalysis,
} from "@/lib/transcription/workflow";

const analysis: TranscriptionAnalysis = {
  id: "analysis-1",
  videoFileName: "lecture.mp4",
  pdfFileName: "notes.pdf",
  videoStoragePath: "storage/videos/generated.mp4",
  status: AnalysisStatus.UPLOADED,
  transcriptText: null,
};

const transcription: AiTranscriptionResult = {
  text: "Today we will discuss deadlocks.",
  language: null,
  durationSeconds: null,
  segments: [],
  model: "gemini-3.8-flash",
};
const leaseToken = "lease-1";

function createRepository(
  currentAnalysis: TranscriptionAnalysis | null = analysis,
): TranscriptionRepository & {
  claim: ReturnType<typeof vi.fn<TranscriptionRepository["claim"]>>;
  complete: ReturnType<typeof vi.fn<TranscriptionRepository["complete"]>>;
  fail: ReturnType<typeof vi.fn<TranscriptionRepository["fail"]>>;
} {
  return {
    findById: vi.fn(async () => currentAnalysis),
    claim: vi.fn(async () => true),
    complete: vi.fn(async () => true),
    fail: vi.fn(async () => undefined),
  };
}

function createVideoLocator(): VideoLocator {
  return {
    locate: vi.fn(async () => ({
      absolutePath: "C:\\private\\storage\\videos\\generated.mp4",
      fileName: "lecture.mp4",
    })),
  };
}

describe("analysis transcription workflow", () => {
  it("rejects an unknown analysis ID", async () => {
    const repository = createRepository(null);

    await expect(
      transcribeAnalysis("missing", {
        client: { transcribe: vi.fn() },
        leaseToken,
        repository,
        videoLocator: createVideoLocator(),
      }),
    ).rejects.toMatchObject({
      code: "ANALYSIS_NOT_FOUND",
      statusCode: 404,
    });
    expect(repository.claim).not.toHaveBeenCalled();
  });

  it("handles a missing stored video and marks the analysis failed", async () => {
    const repository = createRepository();
    const videoLocator: VideoLocator = {
      locate: vi.fn(async () => {
        throw new StoredVideoUnavailableError();
      }),
    };

    await expect(
      transcribeAnalysis(analysis.id, {
        client: { transcribe: vi.fn() },
        leaseToken,
        repository,
        videoLocator,
      }),
    ).rejects.toMatchObject({
      code: "VIDEO_UNAVAILABLE",
      statusCode: 409,
    });
    expect(repository.fail).toHaveBeenCalledWith(analysis.id, leaseToken);
    expect(repository.claim).not.toHaveBeenCalled();
  });

  it("claims TRANSCRIBING, persists text, and advances to EXTRACTING_PDF", async () => {
    let currentStatus: AnalysisStatus = AnalysisStatus.UPLOADED;
    const repository = createRepository();
    repository.claim.mockImplementation(async () => {
      currentStatus = AnalysisStatus.TRANSCRIBING;
      return true;
    });
    const client: TranscriptionClient = {
      transcribe: vi.fn(async () => {
        expect(currentStatus).toBe(AnalysisStatus.TRANSCRIBING);
        return transcription;
      }),
    };
    repository.complete.mockImplementation(async (_id, transcriptText) => {
      expect(transcriptText).toBe(transcription.text);
      currentStatus = AnalysisStatus.EXTRACTING_PDF;
      return true;
    });

    const result = await transcribeAnalysis(analysis.id, {
      client,
      leaseToken,
      repository,
      videoLocator: createVideoLocator(),
    });

    expect(currentStatus).toBe(AnalysisStatus.EXTRACTING_PDF);
    expect(repository.claim).toHaveBeenCalledWith(analysis.id, leaseToken);
    expect(repository.complete).toHaveBeenCalledWith(
      analysis.id,
      transcription.text,
      leaseToken,
    );
    expect(result.status).toBe(AnalysisStatus.EXTRACTING_PDF);
    expect(result.text).toBe(transcription.text);
    expect(JSON.stringify(result)).not.toContain("C:\\private");
    expect(JSON.stringify(result)).not.toContain("storage/videos");
  });

  it("allows a FAILED transcription to retry through the same transition", async () => {
    const repository = createRepository({
      ...analysis,
      status: AnalysisStatus.FAILED,
    });
    const client: TranscriptionClient = {
      transcribe: vi.fn(async () => transcription),
    };

    await expect(
      transcribeAnalysis(analysis.id, {
        client,
        leaseToken,
        repository,
        videoLocator: createVideoLocator(),
      }),
    ).resolves.toMatchObject({
      text: transcription.text,
      status: AnalysisStatus.EXTRACTING_PDF,
    });
    expect(repository.claim).toHaveBeenCalledWith(analysis.id, leaseToken);
    expect(repository.complete).toHaveBeenCalledWith(
      analysis.id,
      transcription.text,
      leaseToken,
    );
  });

  it("marks the analysis FAILED when the Gemini provider fails", async () => {
    const repository = createRepository();
    const client: TranscriptionClient = {
      transcribe: vi.fn(async () => {
        throw new Error("engine failed at C:\\private\\video.mp4");
      }),
    };

    await expect(
      transcribeAnalysis(analysis.id, {
        client,
        leaseToken,
        repository,
        videoLocator: createVideoLocator(),
      }),
    ).rejects.toMatchObject({
      code: "TRANSCRIPTION_FAILED",
      statusCode: 502,
      message: "The lecture could not be transcribed. You can retry this analysis.",
    });
    expect(repository.fail).toHaveBeenCalledWith(analysis.id, leaseToken);
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it("rejects transcription from a later workflow status", async () => {
    const repository = createRepository({
      ...analysis,
      status: AnalysisStatus.EXTRACTING_PDF,
      transcriptText: transcription.text,
    });

    await expect(
      transcribeAnalysis(analysis.id, {
        client: { transcribe: vi.fn() },
        leaseToken,
        repository,
        videoLocator: createVideoLocator(),
      }),
    ).rejects.toMatchObject({
      code: "TRANSCRIPTION_NOT_ALLOWED",
      statusCode: 409,
    });
  });
});
