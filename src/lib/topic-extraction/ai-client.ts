import "server-only";

import { getAiServiceUrl, getAiTranscriptionTimeoutMs } from "@/lib/env";
import {
  TopicExtractionClientError,
  type AiTopicExtractionResult,
  type ExtractedTopic,
  type TopicExtractionClient,
} from "@/lib/topic-extraction/types";

function isExtractedTopic(value: unknown): value is ExtractedTopic {
  if (!value || typeof value !== "object") {
    return false;
  }

  const topic = value as Partial<ExtractedTopic>;
  return (
    typeof topic.name === "string" &&
    topic.name.trim().length > 0 &&
    topic.name.length <= 160 &&
    (topic.confidence === null ||
      (typeof topic.confidence === "number" &&
        Number.isFinite(topic.confidence) &&
        topic.confidence >= 0 &&
        topic.confidence <= 1))
  );
}

function isTopicExtractionResult(
  value: unknown,
): value is AiTopicExtractionResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const result = value as Partial<AiTopicExtractionResult>;
  return Array.isArray(result.topics) && result.topics.every(isExtractedTopic);
}

export function createAiTopicExtractionClient(): TopicExtractionClient {
  return {
    async extract(text, source) {
      let response: Response;

      try {
        response = await fetch(`${getAiServiceUrl()}/extract-topics`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, source }),
          cache: "no-store",
          signal: AbortSignal.timeout(getAiTranscriptionTimeoutMs()),
        });
      } catch (error) {
        throw new TopicExtractionClientError(
          "The topic extraction service is unavailable.",
          { cause: error },
        );
      }

      if (!response.ok) {
        throw new TopicExtractionClientError(
          "The topic extraction service could not process the source text.",
        );
      }

      let result: unknown;
      try {
        result = await response.json();
      } catch (error) {
        throw new TopicExtractionClientError(
          "The topic extraction service returned an invalid response.",
          { cause: error },
        );
      }

      if (!isTopicExtractionResult(result)) {
        throw new TopicExtractionClientError(
          "The topic extraction service returned an invalid response.",
        );
      }

      return {
        topics: result.topics.map((topic) => ({
          name: topic.name.trim(),
          confidence: topic.confidence,
        })),
      };
    },
  };
}
