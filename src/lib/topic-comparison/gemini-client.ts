import "server-only";

import { GoogleGenAI, type EmbedContentParameters } from "@google/genai";
import { MatchType } from "@prisma/client";

import {
  getAiTranscriptionTimeoutMs,
  getGeminiApiKey,
  getGeminiEmbeddingDimensions,
  getGeminiEmbeddingModel,
} from "@/lib/env";
import type {
  AiTopicComparisonMatch,
  AiTopicComparisonResult,
  ComparisonTopic,
  TopicComparisonClient,
} from "@/lib/topic-comparison/types";
import { TopicComparisonClientError } from "@/lib/topic-comparison/types";

export const STRONG_SIMILARITY_THRESHOLD = 0.75;
export const PARTIAL_SIMILARITY_THRESHOLD = 0.55;
export const WEAK_SIMILARITY_THRESHOLD = 0.35;
export const GEMINI_EMBEDDING_TASK_TYPE = "SEMANTIC_SIMILARITY";
export const SEMANTIC_SIMILARITY_WEIGHT = 0.75;
export const LEXICAL_OVERLAP_WEIGHT = 0.25;

const TOPIC_STOP_WORDS = new Set([
  "and",
  "the",
  "of",
  "in",
  "for",
  "between",
]);

interface GeminiEmbeddingResponse {
  readonly embeddings?: readonly {
    readonly values?: readonly number[];
  }[];
}

type EmbedContent = (
  parameters: EmbedContentParameters,
) => Promise<GeminiEmbeddingResponse>;

interface GeminiTopicComparisonClientOptions {
  embedContent?: EmbedContent;
  model?: string;
  dimensions?: number;
  timeoutMs?: number;
}

export function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length === 0 || left.length !== right.length) {
    throw new Error("Embedding vectors must be non-empty and equal in length.");
  }

  let dotProduct = 0;
  let leftMagnitudeSquared = 0;
  let rightMagnitudeSquared = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (
      !Number.isFinite(leftValue) ||
      !Number.isFinite(rightValue)
    ) {
      throw new Error("Embedding vectors must contain only finite values.");
    }

    dotProduct += leftValue * rightValue;
    leftMagnitudeSquared += leftValue * leftValue;
    rightMagnitudeSquared += rightValue * rightValue;
  }

  if (leftMagnitudeSquared === 0 || rightMagnitudeSquared === 0) {
    return 0;
  }

  const similarity =
    dotProduct / Math.sqrt(leftMagnitudeSquared * rightMagnitudeSquared);
  return Math.max(0, Math.min(1, similarity));
}

export function classifySimilarity(similarity: number): MatchType {
  if (similarity >= STRONG_SIMILARITY_THRESHOLD) return MatchType.STRONG;
  if (similarity >= PARTIAL_SIMILARITY_THRESHOLD) return MatchType.PARTIAL;
  if (similarity >= WEAK_SIMILARITY_THRESHOLD) return MatchType.WEAK;
  return MatchType.MISSING;
}

function normalizedTopicTokens(topicName: string): Set<string> {
  return new Set(
    topicName
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(/\s+/u)
      .filter((token) => token.length > 0 && !TOPIC_STOP_WORDS.has(token)),
  );
}

export function lexicalTopicOverlap(
  leftTopicName: string,
  rightTopicName: string,
): number {
  const leftTokens = normalizedTopicTokens(leftTopicName);
  const rightTokens = normalizedTopicTokens(rightTopicName);
  const union = new Set([...leftTokens, ...rightTokens]);

  if (union.size === 0) return 0;

  let intersectionSize = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersectionSize += 1;
  }

  return intersectionSize / union.size;
}

export function hybridTopicSimilarity(
  semanticSimilarity: number,
  lexicalOverlap: number,
): number {
  const hybridSimilarity =
    SEMANTIC_SIMILARITY_WEIGHT * semanticSimilarity +
    LEXICAL_OVERLAP_WEIGHT * lexicalOverlap;
  return Math.max(0, Math.min(1, hybridSimilarity));
}

export interface TopicPairScore {
  semanticSimilarity: number;
  lexicalOverlap: number;
  hybridSimilarity: number;
}

export function scoreTopicPair(
  leftTopicName: string,
  rightTopicName: string,
  leftVector: readonly number[],
  rightVector: readonly number[],
): TopicPairScore {
  const semanticSimilarity = cosineSimilarity(leftVector, rightVector);
  const lexicalOverlap = lexicalTopicOverlap(leftTopicName, rightTopicName);

  return {
    semanticSimilarity,
    lexicalOverlap,
    hybridSimilarity: hybridTopicSimilarity(
      semanticSimilarity,
      lexicalOverlap,
    ),
  };
}

function validateTopics(
  videoTopics: readonly ComparisonTopic[],
  pdfTopics: readonly ComparisonTopic[],
): void {
  if (videoTopics.length === 0 || pdfTopics.length === 0) {
    throw new TopicComparisonClientError(
      "The topic comparison service could not compare these topics.",
    );
  }

  const topicIds = new Set<string>();
  for (const topic of [...videoTopics, ...pdfTopics]) {
    if (
      typeof topic.id !== "string" ||
      topic.id.length < 1 ||
      topic.id.length > 191 ||
      typeof topic.name !== "string" ||
      topic.name.length < 1 ||
      topic.name.length > 160 ||
      topicIds.has(topic.id)
    ) {
      throw new TopicComparisonClientError(
        "The topic comparison service could not compare these topics.",
      );
    }

    topicIds.add(topic.id);
  }
}

function validateSingleEmbedding(
  response: GeminiEmbeddingResponse,
  dimensions: number,
): number[] {
  if (
    !Array.isArray(response.embeddings) ||
    response.embeddings.length !== 1
  ) {
    throw new TopicComparisonClientError(
      "The topic comparison service returned an invalid response.",
    );
  }

  const values = response.embeddings[0].values;
  if (
    !Array.isArray(values) ||
    values.length !== dimensions ||
    values.length === 0 ||
    !values.every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  ) {
    throw new TopicComparisonClientError(
      "The topic comparison service returned an invalid response.",
    );
  }

  return [...values];
}

export function compareTopicVectors(
  videoTopics: readonly ComparisonTopic[],
  pdfTopics: readonly ComparisonTopic[],
  videoVectors: readonly (readonly number[])[],
  pdfVectors: readonly (readonly number[])[],
): AiTopicComparisonResult {
  if (
    videoTopics.length === 0 ||
    videoVectors.length !== videoTopics.length ||
    pdfVectors.length !== pdfTopics.length
  ) {
    throw new Error("Topic vectors do not match the supplied topics.");
  }

  const matches: AiTopicComparisonMatch[] = pdfTopics.map(
    (pdfTopic, pdfIndex) => {
      const pdfVector = pdfVectors[pdfIndex];
      let bestIndex = 0;
      let bestScore = scoreTopicPair(
        pdfTopic.name,
        videoTopics[0].name,
        pdfVector,
        videoVectors[0],
      );

      for (let videoIndex = 1; videoIndex < videoTopics.length; videoIndex += 1) {
        const score = scoreTopicPair(
          pdfTopic.name,
          videoTopics[videoIndex].name,
          pdfVector,
          videoVectors[videoIndex],
        );
        if (score.hybridSimilarity > bestScore.hybridSimilarity) {
          bestIndex = videoIndex;
          bestScore = score;
        }
      }

      const matchType = classifySimilarity(bestScore.hybridSimilarity);
      return {
        pdfTopicId: pdfTopic.id,
        videoTopicId:
          matchType === MatchType.MISSING ? null : videoTopics[bestIndex].id,
        similarityScore: bestScore.hybridSimilarity,
        matchType,
      };
    },
  );

  return { matches };
}

export function createGeminiTopicComparisonClient(
  options: GeminiTopicComparisonClientOptions = {},
): TopicComparisonClient {
  let sdkClient: GoogleGenAI | undefined;

  const embedContent =
    options.embedContent ??
    ((parameters: EmbedContentParameters) => {
      sdkClient ??= new GoogleGenAI({ apiKey: getGeminiApiKey() });
      return sdkClient.models.embedContent(parameters);
    });

  return {
    async compare(videoTopics, pdfTopics) {
      validateTopics(videoTopics, pdfTopics);

      let model: string;
      let dimensions: number;
      let timeoutMs: number;
      try {
        model = options.model ?? getGeminiEmbeddingModel();
        dimensions = options.dimensions ?? getGeminiEmbeddingDimensions();
        timeoutMs = options.timeoutMs ?? getAiTranscriptionTimeoutMs();
      } catch (error) {
        throw new TopicComparisonClientError(
          "The topic comparison service is unavailable.",
          { cause: error },
        );
      }

      const topics = [...videoTopics, ...pdfTopics];
      const vectors: number[][] = [];
      for (const topic of topics) {
        let response: GeminiEmbeddingResponse;
        try {
          response = await embedContent({
            model,
            contents: topic.name,
            config: {
              taskType: GEMINI_EMBEDDING_TASK_TYPE,
              outputDimensionality: dimensions,
              abortSignal: AbortSignal.timeout(timeoutMs),
            },
          });
        } catch (error) {
          throw new TopicComparisonClientError(
            "The topic comparison service could not compare these topics.",
            { cause: error },
          );
        }

        vectors.push(validateSingleEmbedding(response, dimensions));
      }

      return compareTopicVectors(
        videoTopics,
        pdfTopics,
        vectors.slice(0, videoTopics.length),
        vectors.slice(videoTopics.length),
      );
    },
  };
}
