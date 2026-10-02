import {
  AnalysisStatus,
  MatchType,
  Prisma,
  TopicSource,
} from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type {
  TopicComparisonAnalysis,
  TopicComparisonClient,
  TopicComparisonRepository,
} from "@/lib/topic-comparison/types";
import { compareAnalysisTopics } from "@/lib/topic-comparison/workflow";

const analysis: TopicComparisonAnalysis = {
  id: "analysis-1",
  status: AnalysisStatus.COMPARING,
  topics: [
    { id: "video-1", name: "Deadlocks", source: TopicSource.VIDEO },
    { id: "video-2", name: "Virtual Memory", source: TopicSource.VIDEO },
    { id: "pdf-1", name: "Deadlock Prevention", source: TopicSource.PDF },
    { id: "pdf-2", name: "Segmentation", source: TopicSource.PDF },
  ],
};

const comparisonResult = {
  matches: [
    {
      pdfTopicId: "pdf-1",
      videoTopicId: "video-1",
      similarityScore: 0.8,
      matchType: MatchType.STRONG,
    },
    {
      pdfTopicId: "pdf-2",
      videoTopicId: null,
      similarityScore: 0.2,
      matchType: MatchType.MISSING,
    },
  ],
};

function createRepository(
  currentAnalysis: TopicComparisonAnalysis | null = analysis,
): TopicComparisonRepository & {
  claim: ReturnType<typeof vi.fn<TopicComparisonRepository["claim"]>>;
  replaceAndComplete: ReturnType<
    typeof vi.fn<TopicComparisonRepository["replaceAndComplete"]>
  >;
  fail: ReturnType<typeof vi.fn<TopicComparisonRepository["fail"]>>;
} {
  return {
    findById: vi.fn(async () => currentAnalysis),
    claim: vi.fn(async () => true),
    replaceAndComplete: vi.fn(async () => true),
    fail: vi.fn(async () => undefined),
  };
}

function createClient(): TopicComparisonClient & {
  compare: ReturnType<typeof vi.fn<TopicComparisonClient["compare"]>>;
} {
  return { compare: vi.fn(async () => comparisonResult) };
}

describe("topic comparison workflow", () => {
  it("rejects unknown analyses and invalid statuses", async () => {
    await expect(
      compareAnalysisTopics("missing", {
        client: createClient(),
        repository: createRepository(null),
      }),
    ).rejects.toMatchObject({ code: "ANALYSIS_NOT_FOUND", statusCode: 404 });

    const repository = createRepository({
      ...analysis,
      status: AnalysisStatus.EXTRACTING_TOPICS,
    });
    await expect(
      compareAnalysisTopics(analysis.id, { client: createClient(), repository }),
    ).rejects.toMatchObject({
      code: "COMPARISON_NOT_ALLOWED",
      statusCode: 409,
    });
    expect(repository.claim).not.toHaveBeenCalled();
  });

  it("requires both VIDEO and PDF topics", async () => {
    const withoutVideo = createRepository({
      ...analysis,
      topics: analysis.topics.filter((topic) => topic.source === TopicSource.PDF),
    });
    await expect(
      compareAnalysisTopics(analysis.id, {
        client: createClient(),
        repository: withoutVideo,
      }),
    ).rejects.toMatchObject({ code: "VIDEO_TOPICS_REQUIRED" });

    const withoutPdf = createRepository({
      ...analysis,
      topics: analysis.topics.filter(
        (topic) => topic.source === TopicSource.VIDEO,
      ),
    });
    await expect(
      compareAnalysisTopics(analysis.id, {
        client: createClient(),
        repository: withoutPdf,
      }),
    ).rejects.toMatchObject({ code: "PDF_TOPICS_REQUIRED" });
  });

  it("persists the PDF-directed result and deterministic overall score", async () => {
    const repository = createRepository();
    const client = createClient();

    const result = await compareAnalysisTopics(analysis.id, {
      client,
      repository,
    });

    expect(client.compare).toHaveBeenCalledWith(
      analysis.topics.slice(0, 2).map(({ id, name }) => ({ id, name })),
      analysis.topics.slice(2).map(({ id, name }) => ({ id, name })),
    );
    expect(repository.replaceAndComplete).toHaveBeenCalledTimes(1);
    const [, matches, score] = repository.replaceAndComplete.mock.calls[0];
    expect(matches).toEqual(comparisonResult.matches);
    expect(score).toBeInstanceOf(Prisma.Decimal);
    expect(score.toString()).toBe("50");
    expect(result).toEqual({
      analysisId: analysis.id,
      status: AnalysisStatus.COMPLETED,
      overallSimilarityScore: 50,
      matches: [
        {
          ...comparisonResult.matches[0],
          pdfTopicName: "Deadlock Prevention",
          videoTopicName: "Deadlocks",
        },
        {
          ...comparisonResult.matches[1],
          pdfTopicName: "Segmentation",
          videoTopicName: null,
        },
      ],
    });
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it("allows a FAILED comparison with intact topics to retry", async () => {
    const repository = createRepository({
      ...analysis,
      status: AnalysisStatus.FAILED,
    });

    await expect(
      compareAnalysisTopics(analysis.id, {
        client: createClient(),
        repository,
      }),
    ).resolves.toMatchObject({ status: AnalysisStatus.COMPLETED });
    expect(repository.claim).toHaveBeenCalledWith(analysis.id);
  });

  it("marks the analysis FAILED when FastAPI comparison fails", async () => {
    const repository = createRepository();
    const client: TopicComparisonClient = {
      compare: vi.fn(async () => {
        throw new Error("private local model failure");
      }),
    };

    await expect(
      compareAnalysisTopics(analysis.id, { client, repository }),
    ).rejects.toMatchObject({
      code: "COMPARISON_FAILED",
      statusCode: 502,
      message: "Topics could not be compared. You can retry this analysis.",
    });
    expect(repository.replaceAndComplete).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(analysis.id);
  });

  it("marks failure if atomic completion loses its state race", async () => {
    const repository = createRepository();
    repository.replaceAndComplete.mockResolvedValue(false);

    await expect(
      compareAnalysisTopics(analysis.id, {
        client: createClient(),
        repository,
      }),
    ).rejects.toMatchObject({ code: "COMPARISON_FAILED" });
    expect(repository.fail).toHaveBeenCalledWith(analysis.id);
  });
});
