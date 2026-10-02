import "server-only";

import { MatchType } from "@prisma/client";

import { getAiServiceUrl, getAiTranscriptionTimeoutMs } from "@/lib/env";
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

function classifySimilarity(similarity: number): MatchType {
  if (similarity >= STRONG_SIMILARITY_THRESHOLD) return MatchType.STRONG;
  if (similarity >= PARTIAL_SIMILARITY_THRESHOLD) return MatchType.PARTIAL;
  if (similarity >= WEAK_SIMILARITY_THRESHOLD) return MatchType.WEAK;
  return MatchType.MISSING;
}

interface WireTopicComparisonMatch {
  pdf_topic_id: string;
  video_topic_id: string | null;
  similarity_score: number;
  match_type: MatchType;
}

function isComparisonMatch(value: unknown): value is WireTopicComparisonMatch {
  if (!value || typeof value !== "object") return false;

  const match = value as Partial<WireTopicComparisonMatch>;
  return (
    typeof match.pdf_topic_id === "string" &&
    (typeof match.video_topic_id === "string" ||
      match.video_topic_id === null) &&
    typeof match.similarity_score === "number" &&
    Number.isFinite(match.similarity_score) &&
    match.similarity_score >= 0 &&
    match.similarity_score <= 1 &&
    Object.values(MatchType).includes(match.match_type as MatchType)
  );
}

function validateComparisonResult(
  value: unknown,
  videoTopics: readonly ComparisonTopic[],
  pdfTopics: readonly ComparisonTopic[],
): AiTopicComparisonResult | null {
  if (!value || typeof value !== "object") return null;

  const result = value as { matches?: unknown };
  if (
    !Array.isArray(result.matches) ||
    result.matches.length !== pdfTopics.length ||
    !result.matches.every(isComparisonMatch)
  ) {
    return null;
  }

  const matches: AiTopicComparisonMatch[] = result.matches.map((match) => ({
    pdfTopicId: match.pdf_topic_id,
    videoTopicId: match.video_topic_id,
    similarityScore: match.similarity_score,
    matchType: match.match_type,
  }));
  const pdfIds = new Set(pdfTopics.map((topic) => topic.id));
  const videoIds = new Set(videoTopics.map((topic) => topic.id));
  const returnedPdfIds = new Set<string>();

  for (const match of matches) {
    if (
      !pdfIds.has(match.pdfTopicId) ||
      returnedPdfIds.has(match.pdfTopicId) ||
      classifySimilarity(match.similarityScore) !== match.matchType
    ) {
      return null;
    }

    if (match.matchType === MatchType.MISSING) {
      if (match.videoTopicId !== null) return null;
    } else if (
      match.videoTopicId === null ||
      !videoIds.has(match.videoTopicId)
    ) {
      return null;
    }

    returnedPdfIds.add(match.pdfTopicId);
  }

  return returnedPdfIds.size === pdfIds.size
    ? { matches }
    : null;
}

export function createAiTopicComparisonClient(): TopicComparisonClient {
  return {
    async compare(videoTopics, pdfTopics) {
      let response: Response;

      try {
        response = await fetch(`${getAiServiceUrl()}/compare-topics`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            video_topics: videoTopics,
            pdf_topics: pdfTopics,
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(getAiTranscriptionTimeoutMs()),
        });
      } catch (error) {
        throw new TopicComparisonClientError(
          "The topic comparison service is unavailable.",
          { cause: error },
        );
      }

      if (!response.ok) {
        throw new TopicComparisonClientError(
          "The topic comparison service could not compare these topics.",
        );
      }

      let result: unknown;
      try {
        result = await response.json();
      } catch (error) {
        throw new TopicComparisonClientError(
          "The topic comparison service returned an invalid response.",
          { cause: error },
        );
      }

      const validated = validateComparisonResult(
        result,
        videoTopics,
        pdfTopics,
      );
      if (!validated) {
        throw new TopicComparisonClientError(
          "The topic comparison service returned an invalid response.",
        );
      }

      return validated;
    },
  };
}
