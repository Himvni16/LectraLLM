import { readFile } from "node:fs/promises";
import path from "node:path";

import { GoogleGenAI, type EmbedContentParameters } from "@google/genai";
import nextEnv from "@next/env";
import { Prisma } from "@prisma/client";

import type { ComparisonTopic } from "../src/lib/topic-comparison/types";

interface ComparisonInput {
  videoTopics: ComparisonTopic[];
  pdfTopics: ComparisonTopic[];
}

const [, , inputPathArgument] = process.argv;
if (!inputPathArgument) {
  throw new Error(
    "Usage: gemini-comparison-poc.ts <path-to-comparison-topics.json>",
  );
}

nextEnv.loadEnvConfig(process.cwd());

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) {
  throw new Error(
    "GEMINI_API_KEY is not configured. Add it to the server environment before running this POC.",
  );
}

const inputPath = path.resolve(inputPathArgument);
const input = JSON.parse(await readFile(inputPath, "utf8")) as ComparisonInput;
if (!Array.isArray(input.videoTopics) || !Array.isArray(input.pdfTopics)) {
  throw new Error(
    "Input JSON must contain videoTopics and pdfTopics arrays of { id, name } objects.",
  );
}

const { createGeminiTopicComparisonClient, cosineSimilarity } = await import(
  "../src/lib/topic-comparison/gemini-client"
);

const model = process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-2";
const dimensions = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS ?? 768);
const geminiRequestCount = input.videoTopics.length + input.pdfTopics.length;
const gemini = new GoogleGenAI({ apiKey });
const vectors: number[][] = [];
const embedContent = async (parameters: EmbedContentParameters) => {
  const response = await gemini.models.embedContent(parameters);
  const values = response.embeddings?.[0]?.values;
  if (Array.isArray(values)) vectors.push([...values]);
  return response;
};

const startedAt = performance.now();
const result = await createGeminiTopicComparisonClient({
  embedContent,
  model,
  dimensions,
}).compare(input.videoTopics, input.pdfTopics);
const processingTimeMs = Math.round(performance.now() - startedAt);
const videoVectors = vectors.slice(0, input.videoTopics.length);
const pdfVectors = vectors.slice(input.videoTopics.length);
const videoTopicById = new Map(
  input.videoTopics.map((topic) => [topic.id, topic.name] as const),
);
const pdfTopicById = new Map(
  input.pdfTopics.map((topic) => [topic.id, topic.name] as const),
);
const overallScore = result.matches
  .reduce(
    (total, match) => total.plus(match.similarityScore.toString()),
    new Prisma.Decimal(0),
  )
  .dividedBy(input.pdfTopics.length)
  .times(100)
  .toNumber();

console.log("Similarity matrix");
for (const [pdfIndex, pdfTopic] of input.pdfTopics.entries()) {
  console.log(`\nPDF: ${pdfTopic.name}`);
  for (const [videoIndex, videoTopic] of input.videoTopics.entries()) {
    console.log(
      `  ${videoTopic.name}: ${cosineSimilarity(pdfVectors[pdfIndex], videoVectors[videoIndex]).toFixed(4)}`,
    );
  }
}

console.log("\nBest matches");

console.log(
  JSON.stringify(
    {
      model,
      dimensions,
      geminiRequestCount,
      processingTimeMs,
      overallScore,
      matches: result.matches.map((match) => ({
        pdfTopic: pdfTopicById.get(match.pdfTopicId),
        videoTopic:
          match.videoTopicId === null
            ? null
            : videoTopicById.get(match.videoTopicId),
        similarity: match.similarityScore,
        matchType: match.matchType,
      })),
    },
    null,
    2,
  ),
);
