import { AnalysisStatus, TopicSource } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type {
  AiTopicExtractionResult,
  TopicExtractionAnalysis,
  TopicExtractionClient,
  TopicExtractionRepository,
} from "@/lib/topic-extraction/types";
import { extractAnalysisTopics } from "@/lib/topic-extraction/workflow";

const analysis: TopicExtractionAnalysis = {
  id: "analysis-1",
  status: AnalysisStatus.EXTRACTING_TOPICS,
  transcriptText: "The lecture discusses deadlocks and resource allocation graphs.",
  pdfText: "Deadlock prevention includes resource ordering.",
};

const videoResult: AiTopicExtractionResult = {
  topics: [{ name: "Deadlocks", confidence: 0.94 }],
};
const pdfResult: AiTopicExtractionResult = {
  topics: [{ name: "Deadlock Prevention", confidence: 0.9 }],
};
const leaseToken = "lease-1";

function createRepository(
  currentAnalysis: TopicExtractionAnalysis | null = analysis,
): TopicExtractionRepository & {
  claim: ReturnType<typeof vi.fn<TopicExtractionRepository["claim"]>>;
  replaceAndComplete: ReturnType<
    typeof vi.fn<TopicExtractionRepository["replaceAndComplete"]>
  >;
  fail: ReturnType<typeof vi.fn<TopicExtractionRepository["fail"]>>;
} {
  return {
    findById: vi.fn(async () => currentAnalysis),
    claim: vi.fn(async () => true),
    replaceAndComplete: vi.fn(async () => true),
    fail: vi.fn(async () => undefined),
  };
}

function createClient(): TopicExtractionClient & {
  extract: ReturnType<typeof vi.fn<TopicExtractionClient["extract"]>>;
} {
  return {
    extract: vi.fn(async (_text, source) =>
      source === TopicSource.VIDEO ? videoResult : pdfResult,
    ),
  };
}

describe("analysis topic extraction workflow", () => {
  it("rejects an unknown analysis", async () => {
    const repository = createRepository(null);
    const client = createClient();

    await expect(
      extractAnalysisTopics("missing", { client, leaseToken, repository }),
    ).rejects.toMatchObject({ code: "ANALYSIS_NOT_FOUND", statusCode: 404 });
    expect(repository.claim).not.toHaveBeenCalled();
    expect(client.extract).not.toHaveBeenCalled();
  });

  it("rejects an invalid analysis status", async () => {
    const repository = createRepository({
      ...analysis,
      status: AnalysisStatus.EXTRACTING_PDF,
    });

    await expect(
      extractAnalysisTopics(analysis.id, {
        client: createClient(),
        leaseToken,
        repository,
      }),
    ).rejects.toMatchObject({
      code: "TOPIC_EXTRACTION_NOT_ALLOWED",
      statusCode: 409,
    });
    expect(repository.claim).not.toHaveBeenCalled();
  });

  it("rejects an analysis without transcript text", async () => {
    const repository = createRepository({ ...analysis, transcriptText: "  " });

    await expect(
      extractAnalysisTopics(analysis.id, {
        client: createClient(),
        leaseToken,
        repository,
      }),
    ).rejects.toMatchObject({ code: "TRANSCRIPT_REQUIRED", statusCode: 409 });
    expect(repository.claim).not.toHaveBeenCalled();
  });

  it("rejects an analysis without PDF text", async () => {
    const repository = createRepository({ ...analysis, pdfText: null });

    await expect(
      extractAnalysisTopics(analysis.id, {
        client: createClient(),
        leaseToken,
        repository,
      }),
    ).rejects.toMatchObject({ code: "PDF_TEXT_REQUIRED", statusCode: 409 });
    expect(repository.claim).not.toHaveBeenCalled();
  });

  it("extracts each source separately and advances to COMPARING", async () => {
    const repository = createRepository();
    const client = createClient();

    const result = await extractAnalysisTopics(analysis.id, {
      client,
      leaseToken,
      repository,
    });

    expect(client.extract).toHaveBeenCalledTimes(2);
    expect(client.extract).toHaveBeenCalledWith(
      analysis.transcriptText,
      TopicSource.VIDEO,
    );
    expect(client.extract).toHaveBeenCalledWith(
      analysis.pdfText,
      TopicSource.PDF,
    );
    expect(repository.replaceAndComplete).toHaveBeenCalledWith(
      analysis.id,
      videoResult.topics,
      pdfResult.topics,
      leaseToken,
    );
    expect(result).toEqual({
      analysisId: analysis.id,
      status: AnalysisStatus.COMPARING,
      videoTopics: videoResult.topics,
      pdfTopics: pdfResult.topics,
    });
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it("allows a failed analysis with both texts to retry", async () => {
    const repository = createRepository({
      ...analysis,
      status: AnalysisStatus.FAILED,
    });

    const result = await extractAnalysisTopics(analysis.id, {
      client: createClient(),
      leaseToken,
      repository,
    });

    expect(repository.claim).toHaveBeenCalledWith(analysis.id, leaseToken);
    expect(result.status).toBe(AnalysisStatus.COMPARING);
  });

  it("does not persist partial results when one source fails", async () => {
    const repository = createRepository();
    const client: TopicExtractionClient = {
      extract: vi.fn(async (_text, source) => {
        if (source === TopicSource.VIDEO) {
          return videoResult;
        }
        throw new Error("provider failed with private details");
      }),
    };

    await expect(
      extractAnalysisTopics(analysis.id, { client, leaseToken, repository }),
    ).rejects.toMatchObject({
      code: "TOPIC_EXTRACTION_FAILED",
      statusCode: 502,
      message: "Topics could not be extracted. You can retry this analysis.",
    });
    expect(repository.replaceAndComplete).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(analysis.id, leaseToken);
  });

  it("rejects a concurrent state change before provider calls", async () => {
    const repository = createRepository();
    repository.claim.mockResolvedValue(false);
    const client = createClient();

    await expect(
      extractAnalysisTopics(analysis.id, { client, leaseToken, repository }),
    ).rejects.toMatchObject({ code: "TOPIC_EXTRACTION_NOT_ALLOWED" });
    expect(client.extract).not.toHaveBeenCalled();
    expect(repository.replaceAndComplete).not.toHaveBeenCalled();
  });
});
