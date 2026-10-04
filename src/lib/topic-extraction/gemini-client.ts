import "server-only";

import { GoogleGenAI, type GenerateContentParameters } from "@google/genai";
import { TopicSource } from "@prisma/client";

import {
  getAiTranscriptionTimeoutMs,
  getGeminiApiKey,
  getGeminiTopicModel,
  getTopicChunkChars,
} from "@/lib/env";
import {
  TopicExtractionClientError,
  type AiTopicExtractionResult,
  type ExtractedTopic,
  type TopicExtractionClient,
} from "@/lib/topic-extraction/types";

const PARAGRAPH_BOUNDARY = /\n\s*\n+/u;
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/u;
const TOPIC_KEY_PUNCTUATION = /[^\p{L}\p{N}_]+/gu;
const TOPIC_NAME_TRIM = /^[ .,\t\r\n:;–—-]+|[ .,\t\r\n:;–—-]+$/gu;

const TOPIC_EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1, maxLength: 160 },
          confidence: {
            anyOf: [
              { type: "number", minimum: 0, maximum: 1 },
              { type: "null" },
            ],
            default: null,
          },
        },
        required: ["name"],
      },
    },
  },
  required: ["topics"],
} as const;

interface GeminiResponse {
  readonly text?: string;
}

type GenerateContent = (
  parameters: GenerateContentParameters,
) => Promise<GeminiResponse>;

interface GeminiTopicExtractionClientOptions {
  generateContent?: GenerateContent;
  model?: string;
  maxChunkChars?: number;
  timeoutMs?: number;
}

function characterLength(value: string): number {
  return Array.from(value).length;
}

function splitWordsWithoutCutting(text: string, maxChars: number): string[] {
  const parts: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const word of text.split(/\s+/u)) {
    const separatorLength = current.length > 0 ? 1 : 0;
    const projectedLength =
      currentLength + separatorLength + characterLength(word);

    if (current.length > 0 && projectedLength > maxChars) {
      parts.push(current.join(" "));
      current = [word];
      currentLength = characterLength(word);
    } else {
      current.push(word);
      currentLength = projectedLength;
    }
  }

  if (current.length > 0) {
    parts.push(current.join(" "));
  }

  return parts;
}

function splitOversizedParagraph(
  paragraph: string,
  maxChars: number,
): string[] {
  const parts: string[] = [];

  for (const rawSentence of paragraph.split(SENTENCE_BOUNDARY)) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;

    if (characterLength(sentence) <= maxChars) {
      parts.push(sentence);
    } else {
      parts.push(...splitWordsWithoutCutting(sentence, maxChars));
    }
  }

  return parts;
}

export function chunkTopicText(text: string, maxChars: number): string[] {
  if (maxChars < 1) {
    throw new Error("Topic chunk size must be positive.");
  }

  const normalized = text.replace(/\r\n?/gu, "\n").trim();
  if (!normalized) return [];

  const segments: string[] = [];
  for (const rawParagraph of normalized.split(PARAGRAPH_BOUNDARY)) {
    const paragraph = rawParagraph.trim().split(/\s+/u).join(" ");
    if (!paragraph) continue;

    if (characterLength(paragraph) <= maxChars) {
      segments.push(paragraph);
    } else {
      segments.push(...splitOversizedParagraph(paragraph, maxChars));
    }
  }

  const chunks: string[] = [];
  let current = "";

  for (const segment of segments) {
    const candidate = current ? `${current}\n\n${segment}` : segment;
    if (current && characterLength(candidate) > maxChars) {
      chunks.push(current);
      current = segment;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function cleanTopicName(name: string): string {
  return name.split(/\s+/u).join(" ").replace(TOPIC_NAME_TRIM, "");
}

function topicKey(name: string): string {
  return name
    .toLocaleLowerCase("und")
    .replace(/ß/gu, "ss")
    .replace(/ς/gu, "σ")
    .replace(TOPIC_KEY_PUNCTUATION, " ")
    .split(/\s+/u)
    .join(" ")
    .trim();
}

export function mergeTopicResults(
  results: readonly AiTopicExtractionResult[],
): AiTopicExtractionResult {
  const merged = new Map<string, ExtractedTopic>();

  for (const result of results) {
    for (const topic of result.topics) {
      const name = cleanTopicName(topic.name);
      const key = topicKey(name);
      if (!name || !key) continue;

      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { name, confidence: topic.confidence });
        continue;
      }

      const confidences = [existing.confidence, topic.confidence].filter(
        (confidence): confidence is number => confidence !== null,
      );
      if (confidences.length > 0) {
        merged.set(key, {
          ...existing,
          confidence: Math.max(...confidences),
        });
      }
    }
  }

  return { topics: [...merged.values()] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function parseTopic(value: unknown): ExtractedTopic | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["name", "confidence"])) {
    return null;
  }

  if (
    typeof value.name !== "string" ||
    value.name.length < 1 ||
    value.name.length > 160
  ) {
    return null;
  }

  const confidence = value.confidence ?? null;
  if (
    confidence !== null &&
    (typeof confidence !== "number" ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1)
  ) {
    return null;
  }

  return { name: value.name, confidence };
}

function parseTopicExtractionResult(text: string): AiTopicExtractionResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new TopicExtractionClientError(
      "The topic extraction service returned an invalid response.",
      { cause: error },
    );
  }

  if (!isRecord(value) || !hasOnlyKeys(value, ["topics"])) {
    throw new TopicExtractionClientError(
      "The topic extraction service returned an invalid response.",
    );
  }

  if (!Array.isArray(value.topics)) {
    throw new TopicExtractionClientError(
      "The topic extraction service returned an invalid response.",
    );
  }

  const topics = value.topics.map(parseTopic);
  if (topics.some((topic) => topic === null)) {
    throw new TopicExtractionClientError(
      "The topic extraction service returned an invalid response.",
    );
  }

  return { topics: topics as ExtractedTopic[] };
}

function topicInstructions(source: TopicSource): string {
  const sourceInstruction =
    source === TopicSource.VIDEO
      ? "Extract only topics clearly discussed in the lecture transcript."
      : "Extract useful PDF topics and subtopics that are present in the text.";

  return (
    "You extract distinct academic topics from source material. " +
    `${sourceInstruction} ` +
    "Preserve meaningful technical terminology, use concise names, and " +
    "do not invent concepts. Avoid duplicates and generic labels such as " +
    "Introduction, Conclusion, Summary, or Overview unless the label itself " +
    "is a meaningful academic subject. Assign each topic a confidence from " +
    "0 to 1 based only on evidence in this source chunk."
  );
}

function topicContents(text: string, source: TopicSource): string {
  return (
    `Source type: ${source}\n\n` +
    "Extract structured topics from this source text:\n\n" +
    text
  );
}

export function createGeminiTopicExtractionClient(
  options: GeminiTopicExtractionClientOptions = {},
): TopicExtractionClient {
  let sdkClient: GoogleGenAI | undefined;

  const generateContent =
    options.generateContent ??
    ((parameters: GenerateContentParameters) => {
      sdkClient ??= new GoogleGenAI({ apiKey: getGeminiApiKey() });
      return sdkClient.models.generateContent(parameters);
    });

  return {
    async extract(text, source) {
      let model: string;
      let maxChunkChars: number;
      let timeoutMs: number;

      try {
        model = options.model ?? getGeminiTopicModel();
        maxChunkChars = options.maxChunkChars ?? getTopicChunkChars();
        timeoutMs = options.timeoutMs ?? getAiTranscriptionTimeoutMs();
      } catch (error) {
        throw new TopicExtractionClientError(
          "The topic extraction service is unavailable.",
          { cause: error },
        );
      }

      const chunks = chunkTopicText(text, maxChunkChars);
      if (chunks.length === 0) {
        throw new TopicExtractionClientError(
          "The topic extraction service could not process the source text.",
        );
      }

      const results: AiTopicExtractionResult[] = [];
      for (const chunk of chunks) {
        let response: GeminiResponse;
        try {
          response = await generateContent({
            model,
            contents: topicContents(chunk, source),
            config: {
              systemInstruction: topicInstructions(source),
              responseMimeType: "application/json",
              responseJsonSchema: TOPIC_EXTRACTION_SCHEMA,
              temperature: 0,
              automaticFunctionCalling: { disable: true },
              abortSignal: AbortSignal.timeout(timeoutMs),
            },
          });
        } catch (error) {
          throw new TopicExtractionClientError(
            "The topic extraction service could not process the source text.",
            { cause: error },
          );
        }

        if (!response.text) {
          throw new TopicExtractionClientError(
            "The topic extraction service returned an invalid response.",
          );
        }

        results.push(parseTopicExtractionResult(response.text));
      }

      return mergeTopicResults(results);
    },
  };
}
