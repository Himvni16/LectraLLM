import type { EmbedContentParameters } from "@google/genai";
import { MatchType } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  classifySimilarity,
  compareTopicVectors,
  cosineSimilarity,
  createGeminiTopicComparisonClient,
  GEMINI_EMBEDDING_TASK_TYPE,
  hybridTopicSimilarity,
  lexicalTopicOverlap,
  scoreTopicPair,
} from "@/lib/topic-comparison/gemini-client";

const videoTopics = [
  { id: "video-1", name: "Deadlocks" },
  { id: "video-2", name: "Virtual Memory" },
];
const pdfTopics = [
  { id: "pdf-1", name: "Deadlock Prevention" },
  { id: "pdf-2", name: "Memory Segmentation" },
  { id: "pdf-3", name: "Uncovered Topic" },
];

const TEST_OPTIONS = {
  model: "gemini-embedding-test",
  dimensions: 2,
  timeoutMs: 1_000,
};

function createEmbeddingMock(vectors: readonly (readonly number[])[]) {
  let vectorIndex = 0;
  return vi.fn(async (parameters: EmbedContentParameters) => {
    void parameters;
    const values = vectors[vectorIndex];
    vectorIndex += 1;
    if (!values) throw new Error("Missing mocked embedding vector.");

    return {
      embeddings: [{ values: [...values] }],
    };
  });
}

describe("Gemini topic comparison client", () => {
  it("calculates same-vector, orthogonal, low, and zero-vector cosine safely", () => {
    expect(cosineSimilarity([1, 2], [1, 2])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });

  it("rejects empty, mismatched, and non-finite vectors", () => {
    expect(() => cosineSimilarity([], [])).toThrow(
      "Embedding vectors must be non-empty and equal in length.",
    );
    expect(() => cosineSimilarity([1], [1, 2])).toThrow(
      "Embedding vectors must be non-empty and equal in length.",
    );
    expect(() => cosineSimilarity([1, Number.NaN], [1, 2])).toThrow(
      "Embedding vectors must contain only finite values.",
    );
  });

  it.each([
    [0.75, MatchType.STRONG],
    [0.749, MatchType.PARTIAL],
    [0.55, MatchType.PARTIAL],
    [0.549, MatchType.WEAK],
    [0.35, MatchType.WEAK],
    [0.349, MatchType.MISSING],
  ])("classifies similarity %s as %s", (similarity, expected) => {
    expect(classifySimilarity(similarity)).toBe(expected);
  });

  it("gives identical topics maximum lexical and hybrid scores", () => {
    const score = scoreTopicPair(
      "PDF Content Processing",
      "PDF Content Processing",
      [1, 2],
      [1, 2],
    );

    expect(score).toEqual({
      semanticSimilarity: 1,
      lexicalOverlap: 1,
      hybridSimilarity: 1,
    });
    expect(classifySimilarity(score.hybridSimilarity)).toBe(MatchType.STRONG);
  });

  it("penalizes Semantic Analysis versus Sentiment Analysis", () => {
    const lexicalOverlap = lexicalTopicOverlap(
      "Semantic Analysis",
      "Sentiment Analysis",
    );
    const hybridSimilarity = hybridTopicSimilarity(0.8488, lexicalOverlap);

    expect(lexicalOverlap).toBeCloseTo(1 / 3);
    expect(hybridSimilarity).toBeCloseTo(0.7199, 4);
    expect(classifySimilarity(hybridSimilarity)).toBe(MatchType.PARTIAL);
  });

  it("penalizes Video Content Analysis versus Content Correlation Analysis", () => {
    const lexicalOverlap = lexicalTopicOverlap(
      "Video Content Analysis",
      "Content Correlation Analysis",
    );
    const hybridSimilarity = hybridTopicSimilarity(0.7755, lexicalOverlap);

    expect(lexicalOverlap).toBe(0.5);
    expect(hybridSimilarity).toBeCloseTo(0.7066, 4);
    expect(classifySimilarity(hybridSimilarity)).toBe(MatchType.PARTIAL);
  });

  it("keeps exact technical multiword concepts strong", () => {
    for (const topicName of [
      "Learning Management System",
      "Audio Transcription",
      "Video-PDF Content Matching",
    ]) {
      const score = scoreTopicPair(topicName, topicName, [1, 0], [1, 0]);
      expect(score.hybridSimilarity).toBe(1);
      expect(classifySimilarity(score.hybridSimilarity)).toBe(
        MatchType.STRONG,
      );
    }
  });

  it("normalizes topic punctuation and case for lexical overlap", () => {
    expect(
      lexicalTopicOverlap(
        "VIDEO—PDF Content-Matching!",
        "video pdf content matching",
      ),
    ).toBe(1);
  });

  it("ignores generic stop words without removing technical terms", () => {
    expect(
      lexicalTopicOverlap(
        "Analysis of Video and PDF Content",
        "Video PDF Content Analysis",
      ),
    ).toBe(1);
    expect(lexicalTopicOverlap("Semantic Analysis", "Sentiment Analysis")).toBe(
      1 / 3,
    );
    expect(
      lexicalTopicOverlap("Coverage Validation", "Correlation Analysis"),
    ).toBe(0);
    for (const technicalToken of [
      "video",
      "pdf",
      "semantic",
      "sentiment",
      "transcription",
      "correlation",
      "validation",
      "coverage",
      "analysis",
    ]) {
      expect(lexicalTopicOverlap(technicalToken, technicalToken)).toBe(1);
    }
  });

  it("embeds VIDEO then PDF names sequentially and maps vectors to their topics", async () => {
    const embedContent = createEmbeddingMock([
      [1, 0],
      [0, 1],
      [0.8, 0.6],
      [0.6, 0.8],
      [-1, 0],
    ]);

    const result = await createGeminiTopicComparisonClient({
      ...TEST_OPTIONS,
      embedContent,
    }).compare(videoTopics, pdfTopics);

    expect(embedContent).toHaveBeenCalledTimes(5);
    expect(
      embedContent.mock.calls.map(([parameters]) => parameters.contents),
    ).toEqual([
      "Deadlocks",
      "Virtual Memory",
      "Deadlock Prevention",
      "Memory Segmentation",
      "Uncovered Topic",
    ]);
    for (const [parameters] of embedContent.mock.calls) {
      expect(parameters).toEqual({
        model: "gemini-embedding-test",
        contents: expect.any(String),
        config: expect.objectContaining({
          taskType: GEMINI_EMBEDDING_TASK_TYPE,
          outputDimensionality: 2,
        }),
      });
    }
    expect(result.matches).toHaveLength(3);
    expect(result.matches[0]).toMatchObject({
      pdfTopicId: "pdf-1",
      videoTopicId: "video-1",
      matchType: MatchType.PARTIAL,
    });
    expect(result.matches[0]?.similarityScore).toBeCloseTo(0.6);
    expect(result.matches[1]).toMatchObject({
      pdfTopicId: "pdf-2",
      videoTopicId: "video-2",
      matchType: MatchType.PARTIAL,
    });
    expect(result.matches[1]?.similarityScore).toBeCloseTo(0.6833333333);
    expect(result.matches[2]).toEqual({
      pdfTopicId: "pdf-3",
      videoTopicId: null,
      similarityScore: 0,
      matchType: MatchType.MISSING,
    });
  });

  it("preserves the first VIDEO topic when best similarities tie", () => {
    const result = compareTopicVectors(
      videoTopics,
      [pdfTopics[0]],
      [
        [1, 0],
        [0, 1],
      ],
      [[1, 1]],
    );

    expect(result.matches[0]).toMatchObject({
      pdfTopicId: "pdf-1",
      videoTopicId: "video-1",
      matchType: MatchType.WEAK,
    });
    expect(result.matches[0]?.similarityScore).toBeCloseTo(
      0.75 * Math.SQRT1_2,
    );
  });

  it.each([
    ["missing embeddings", {}],
    [
      "wrong embedding count",
      { embeddings: [{ values: [1, 0] }, { values: [0, 1] }] },
    ],
    ["missing values", { embeddings: [{}] }],
    [
      "empty vector",
      { embeddings: [{ values: [] }] },
    ],
    [
      "wrong vector length",
      { embeddings: [{ values: [1] }] },
    ],
    [
      "non-finite vector",
      {
        embeddings: [{ values: [1, Number.POSITIVE_INFINITY] }],
      },
    ],
  ])("rejects an embedding response with %s", async (_reason, response) => {
    const embedContent = vi.fn(async (parameters: EmbedContentParameters) => {
      void parameters;
      return response;
    });

    await expect(
      createGeminiTopicComparisonClient({
        ...TEST_OPTIONS,
        embedContent,
      }).compare(videoTopics, pdfTopics),
    ).rejects.toMatchObject({
      name: "TopicComparisonClientError",
      message: "The topic comparison service returned an invalid response.",
    });
  });

  it("sanitizes Gemini embedding failures", async () => {
    const embedContent = vi.fn(async (parameters: EmbedContentParameters) => {
      void parameters;
      throw new Error("provider detail that must remain server-side");
    });

    await expect(
      createGeminiTopicComparisonClient({
        ...TEST_OPTIONS,
        embedContent,
      }).compare(videoTopics, pdfTopics),
    ).rejects.toMatchObject({
      name: "TopicComparisonClientError",
      message: "The topic comparison service could not compare these topics.",
    });
  });
});
