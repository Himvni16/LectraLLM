import { AnalysisStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TranscriptionOperationError } from "@/lib/transcription/errors";
import { StoredVideoUnavailableError } from "@/lib/transcription/media";
import type {
  AiTranscriptionResult,
  TranscriptionAnalysis,
  TranscriptionClient,
  TranscriptionProviderFile,
  TranscriptionRepository,
  VideoLocator,
} from "@/lib/transcription/types";
import { transcribeAnalysis } from "@/lib/transcription/workflow";

const leaseToken = "lease-1";
const providerName = "files/gemini-video-1";

const analysis: TranscriptionAnalysis = {
  id: "analysis-1",
  videoFileName: "lecture.mp4",
  pdfFileName: "notes.pdf",
  videoStoragePath: "lectrallm/videos/generated",
  status: AnalysisStatus.TRANSCRIBING,
  transcriptText: null,
  transcriptionProviderFile: null,
};

const processingFile: TranscriptionProviderFile = {
  name: providerName,
  state: "PROCESSING",
  uri: null,
  mimeType: null,
};

const activeFile: TranscriptionProviderFile = {
  name: providerName,
  state: "ACTIVE",
  uri: "https://generativelanguage.googleapis.com/files/video-1",
  mimeType: "video/mp4",
};

const transcription: AiTranscriptionResult = {
  text: "Today we will discuss deadlocks.",
  language: null,
  durationSeconds: null,
  segments: [],
  model: "gemini-3.8-flash",
};

function createRepository(
  currentAnalysis: TranscriptionAnalysis | null = analysis,
): TranscriptionRepository & {
  findById: ReturnType<typeof vi.fn>;
  claim: ReturnType<typeof vi.fn>;
  persistProviderFile: ReturnType<typeof vi.fn>;
  clearProviderFile: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
  fail: ReturnType<typeof vi.fn>;
} {
  return {
    findById: vi.fn(async () => currentAnalysis),
    claim: vi.fn(async () => true),
    persistProviderFile: vi.fn(async () => true),
    clearProviderFile: vi.fn(async () => true),
    complete: vi.fn(async () => true),
    fail: vi.fn(async () => true),
  };
}

function createClient(
  overrides: Partial<TranscriptionClient> = {},
): TranscriptionClient {
  return {
    upload: vi.fn(async () => processingFile),
    getFile: vi.fn(async () => processingFile),
    generate: vi.fn(async () => transcription),
    deleteFile: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createVideoLocator(): VideoLocator {
  return {
    locate: vi.fn(async () => ({
      publicId: analysis.videoStoragePath,
      fileName: analysis.videoFileName,
      contentType: "video/mp4",
      size: 1_024,
    })),
  };
}

describe("resumable analysis transcription workflow", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("rejects an unknown analysis ID without touching Gemini", async () => {
    const repository = createRepository(null);
    const client = createClient();

    await expect(
      transcribeAnalysis("missing", {
        client,
        leaseToken,
        repository,
        videoLocator: createVideoLocator(),
      }),
    ).rejects.toMatchObject({ code: "ANALYSIS_NOT_FOUND", statusCode: 404 });
    expect(repository.claim).not.toHaveBeenCalled();
    expect(client.upload).not.toHaveBeenCalled();
  });

  it("uploads once, persists the provider file, and exits without polling or generating", async () => {
    const repository = createRepository();
    const client = createClient();

    await expect(
      transcribeAnalysis(analysis.id, {
        client,
        leaseToken,
        repository,
        videoLocator: createVideoLocator(),
      }),
    ).resolves.toMatchObject({
      outcome: "UPLOADED",
      status: AnalysisStatus.TRANSCRIBING,
    });

    expect(client.upload).toHaveBeenCalledOnce();
    expect(repository.persistProviderFile).toHaveBeenCalledWith(
      analysis.id,
      providerName,
      leaseToken,
    );
    expect(client.getFile).not.toHaveBeenCalled();
    expect(client.generate).not.toHaveBeenCalled();
  });

  it("does not duplicate provider work when another invocation owns the lease", async () => {
    const repository = createRepository();
    repository.claim.mockResolvedValue(false);
    const client = createClient();

    await expect(
      transcribeAnalysis(analysis.id, {
        client,
        leaseToken: "overlapping-worker",
        repository,
        videoLocator: createVideoLocator(),
      }),
    ).rejects.toMatchObject({
      code: "TRANSCRIPTION_NOT_ALLOWED",
      statusCode: 409,
    });
    expect(client.upload).not.toHaveBeenCalled();
    expect(client.getFile).not.toHaveBeenCalled();
    expect(client.generate).not.toHaveBeenCalled();
  });

  it("treats PROCESSING as normal and never re-uploads persisted provider state", async () => {
    const repository = createRepository({
      ...analysis,
      transcriptionProviderFile: providerName,
    });
    const client = createClient();

    const result = await transcribeAnalysis(analysis.id, {
      client,
      leaseToken,
      repository,
      videoLocator: createVideoLocator(),
    });

    expect(result).toMatchObject({
      outcome: "PROCESSING",
      status: AnalysisStatus.TRANSCRIBING,
    });
    expect(client.getFile).toHaveBeenCalledWith(providerName);
    expect(client.upload).not.toHaveBeenCalled();
    expect(client.generate).not.toHaveBeenCalled();
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it.each([
    ["Gemini 429", "RATE_LIMIT"],
    ["Gemini 5xx", "PROVIDER_5XX"],
    ["network timeout", "PROVIDER_TIMEOUT"],
    ["ECONNRESET", "NETWORK_RESET"],
  ] as const)(
    "keeps TRANSCRIBING after a retryable %s generation failure",
    async (_label, category) => {
      const repository = createRepository({
        ...analysis,
        transcriptionProviderFile: providerName,
      });
      const client = createClient({
        getFile: vi.fn(async () => activeFile),
        generate: vi.fn(async () => {
          throw new TranscriptionOperationError(
            "safe retryable provider failure",
            category,
            true,
          );
        }),
      });

      await expect(
        transcribeAnalysis(analysis.id, {
          client,
          leaseToken,
          repository,
          videoLocator: createVideoLocator(),
        }),
      ).resolves.toMatchObject({
        outcome: "RETRYABLE",
        status: AnalysisStatus.TRANSCRIBING,
      });

      expect(repository.fail).not.toHaveBeenCalled();
      expect(repository.clearProviderFile).not.toHaveBeenCalled();
      expect(repository.complete).not.toHaveBeenCalled();
      expect(client.deleteFile).not.toHaveBeenCalled();
    },
  );

  it("logs only safe structured metadata for a retryable failure", async () => {
    const repository = createRepository({
      ...analysis,
      transcriptionProviderFile: providerName,
    });
    const logger = { warn: vi.fn(), error: vi.fn() };
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValue(1_250);
    const client = createClient({
      getFile: vi.fn(async () => activeFile),
      generate: vi.fn(async () => {
        throw new TranscriptionOperationError(
          "secret provider detail",
          "RATE_LIMIT",
          true,
        );
      }),
    });

    await transcribeAnalysis(analysis.id, {
      client,
      leaseToken,
      repository,
      videoLocator: createVideoLocator(),
      logger,
      now,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      "Retryable transcription operation failed.",
      {
        analysisId: analysis.id,
        stage: "transcription",
        operation: "transcript-generation",
        retryable: true,
        category: "RATE_LIMIT",
        providerFilePresent: true,
        elapsedMs: 250,
      },
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret");
  });

  it("generates exactly once when ACTIVE, persists the transcript, advances, and cleans up", async () => {
    const repository = createRepository({
      ...analysis,
      transcriptionProviderFile: providerName,
    });
    const client = createClient({ getFile: vi.fn(async () => activeFile) });

    const result = await transcribeAnalysis(analysis.id, {
      client,
      leaseToken,
      repository,
      videoLocator: createVideoLocator(),
    });

    expect(client.generate).toHaveBeenCalledOnce();
    expect(client.generate).toHaveBeenCalledWith(activeFile);
    expect(repository.complete).toHaveBeenCalledWith(
      analysis.id,
      providerName,
      transcription.text,
      leaseToken,
    );
    expect(client.deleteFile).toHaveBeenCalledWith(providerName);
    expect(result).toMatchObject({
      outcome: "COMPLETED",
      status: AnalysisStatus.EXTRACTING_PDF,
      transcription,
    });
  });

  it("clears an expired provider file and lets a later invocation upload again", async () => {
    let current: TranscriptionAnalysis = {
      ...analysis,
      transcriptionProviderFile: providerName,
    };
    const repository = createRepository(current);
    repository.findById.mockImplementation(async () => current);
    repository.clearProviderFile.mockImplementation(async () => {
      current = { ...current, transcriptionProviderFile: null };
      return true;
    });
    const client = createClient({
      getFile: vi.fn(async (): Promise<TranscriptionProviderFile> => ({
        name: providerName,
        state: "NOT_FOUND",
        uri: null,
        mimeType: null,
      })),
    });

    await expect(
      transcribeAnalysis(analysis.id, {
        client,
        leaseToken,
        repository,
        videoLocator: createVideoLocator(),
      }),
    ).resolves.toMatchObject({ outcome: "PROVIDER_EXPIRED" });
    await expect(
      transcribeAnalysis(analysis.id, {
        client,
        leaseToken,
        repository,
        videoLocator: createVideoLocator(),
      }),
    ).resolves.toMatchObject({ outcome: "UPLOADED" });

    expect(repository.clearProviderFile).toHaveBeenCalledWith(
      analysis.id,
      providerName,
      leaseToken,
    );
    expect(client.upload).toHaveBeenCalledOnce();
  });

  it("fails and clears an unusable provider file before cleanup", async () => {
    const repository = createRepository({
      ...analysis,
      transcriptionProviderFile: providerName,
    });
    const client = createClient({
      getFile: vi.fn(async (): Promise<TranscriptionProviderFile> => ({
        name: providerName,
        state: "FAILED",
        uri: null,
        mimeType: null,
      })),
    });

    await expect(
      transcribeAnalysis(analysis.id, {
        client,
        leaseToken,
        repository,
        videoLocator: createVideoLocator(),
      }),
    ).rejects.toMatchObject({ code: "TRANSCRIPTION_FAILED", statusCode: 502 });
    expect(repository.fail).toHaveBeenCalledWith(
      analysis.id,
      leaseToken,
      true,
    );
    expect(client.deleteFile).toHaveBeenCalledWith(providerName);
  });

  it("reuses persisted provider state when retrying from FAILED", async () => {
    const repository = createRepository({
      ...analysis,
      status: AnalysisStatus.FAILED,
      transcriptionProviderFile: providerName,
    });
    const client = createClient({ getFile: vi.fn(async () => activeFile) });

    await transcribeAnalysis(analysis.id, {
      client,
      leaseToken,
      repository,
      videoLocator: createVideoLocator(),
    });

    expect(client.upload).not.toHaveBeenCalled();
    expect(client.getFile).toHaveBeenCalledWith(providerName);
    expect(client.generate).toHaveBeenCalledOnce();
  });

  it("cleans a newly uploaded provider file if the lease owner cannot persist it", async () => {
    const repository = createRepository();
    repository.persistProviderFile.mockResolvedValue(false);
    const client = createClient();

    await expect(
      transcribeAnalysis(analysis.id, {
        client,
        leaseToken,
        repository,
        videoLocator: createVideoLocator(),
      }),
    ).rejects.toMatchObject({
      code: "TRANSCRIPTION_NOT_ALLOWED",
      statusCode: 409,
    });
    expect(client.deleteFile).toHaveBeenCalledWith(providerName);
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it("does not let cleanup failure undo a completed transcript", async () => {
    const repository = createRepository({
      ...analysis,
      transcriptionProviderFile: providerName,
    });
    const client = createClient({
      getFile: vi.fn(async () => activeFile),
      deleteFile: vi.fn(async () => {
        throw new Error("cleanup unavailable");
      }),
    });

    await expect(
      transcribeAnalysis(analysis.id, {
        client,
        leaseToken,
        repository,
        videoLocator: createVideoLocator(),
      }),
    ).resolves.toMatchObject({ outcome: "COMPLETED" });
    expect(repository.complete).toHaveBeenCalledOnce();
  });

  it("does not clean or overwrite persisted state after losing ownership at completion", async () => {
    const repository = createRepository({
      ...analysis,
      transcriptionProviderFile: providerName,
    });
    repository.complete.mockResolvedValue(false);
    const client = createClient({ getFile: vi.fn(async () => activeFile) });

    await expect(
      transcribeAnalysis(analysis.id, {
        client,
        leaseToken: "stale-worker",
        repository,
        videoLocator: createVideoLocator(),
      }),
    ).rejects.toMatchObject({
      code: "TRANSCRIPTION_NOT_ALLOWED",
      statusCode: 409,
    });
    expect(client.deleteFile).not.toHaveBeenCalled();
  });

  it("preserves reusable provider state when generation fails", async () => {
    const repository = createRepository({
      ...analysis,
      transcriptionProviderFile: providerName,
    });
    const client = createClient({
      getFile: vi.fn(async () => activeFile),
      generate: vi.fn(async () => {
        throw new Error("provider unavailable");
      }),
    });

    await expect(
      transcribeAnalysis(analysis.id, {
        client,
        leaseToken,
        repository,
        videoLocator: createVideoLocator(),
      }),
    ).rejects.toMatchObject({ code: "TRANSCRIPTION_FAILED" });
    expect(repository.fail).toHaveBeenCalledWith(
      analysis.id,
      leaseToken,
      false,
    );
    expect(client.deleteFile).not.toHaveBeenCalled();
  });

  it("treats an empty successful provider response as terminal", async () => {
    const repository = createRepository({
      ...analysis,
      transcriptionProviderFile: providerName,
    });
    const client = createClient({
      getFile: vi.fn(async () => activeFile),
      generate: vi.fn(async () => ({ ...transcription, text: "   " })),
    });

    await expect(
      transcribeAnalysis(analysis.id, {
        client,
        leaseToken,
        repository,
        videoLocator: createVideoLocator(),
      }),
    ).rejects.toMatchObject({ code: "TRANSCRIPTION_FAILED" });
    expect(repository.fail).toHaveBeenCalledWith(
      analysis.id,
      leaseToken,
      false,
    );
  });

  it("handles an unavailable stored video without contacting Gemini", async () => {
    const repository = createRepository();
    const client = createClient();
    const videoLocator: VideoLocator = {
      locate: vi.fn(async () => {
        throw new StoredVideoUnavailableError();
      }),
    };

    await expect(
      transcribeAnalysis(analysis.id, {
        client,
        leaseToken,
        repository,
        videoLocator,
      }),
    ).rejects.toMatchObject({ code: "VIDEO_UNAVAILABLE", statusCode: 409 });
    expect(repository.fail).toHaveBeenCalledWith(
      analysis.id,
      leaseToken,
      false,
    );
    expect(client.upload).not.toHaveBeenCalled();
  });

  it("keeps TRANSCRIBING after a transient Cloudinary lookup failure", async () => {
    const repository = createRepository();
    const client = createClient();
    const videoLocator: VideoLocator = {
      locate: vi.fn(async () => {
        throw new TranscriptionOperationError(
          "temporary Cloudinary failure",
          "PROVIDER_5XX",
          true,
        );
      }),
    };

    await expect(
      transcribeAnalysis(analysis.id, {
        client,
        leaseToken,
        repository,
        videoLocator,
      }),
    ).resolves.toMatchObject({
      outcome: "RETRYABLE",
      status: AnalysisStatus.TRANSCRIBING,
    });
    expect(repository.fail).not.toHaveBeenCalled();
    expect(client.upload).not.toHaveBeenCalled();
  });

  it("rejects a later workflow status before claiming or contacting Gemini", async () => {
    const repository = createRepository({
      ...analysis,
      status: AnalysisStatus.EXTRACTING_PDF,
      transcriptText: transcription.text,
    });
    const client = createClient();

    await expect(
      transcribeAnalysis(analysis.id, {
        client,
        leaseToken,
        repository,
        videoLocator: createVideoLocator(),
      }),
    ).rejects.toMatchObject({
      code: "TRANSCRIPTION_NOT_ALLOWED",
      statusCode: 409,
    });
    expect(repository.claim).not.toHaveBeenCalled();
    expect(client.upload).not.toHaveBeenCalled();
  });
});
