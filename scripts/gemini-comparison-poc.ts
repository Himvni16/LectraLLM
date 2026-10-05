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

const {
  classifySimilarity,
  createGeminiTopicComparisonClient,
  scoreTopicPair,
} = await import("../src/lib/topic-comparison/gemini-client");

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
const overallScore = result.matches
  .reduce(
    (total, match) => total.plus(match.similarityScore.toString()),
    new Prisma.Decimal(0),
  )
  .dividedBy(input.pdfTopics.length)
  .times(100)
  .toNumber();

interface CandidateMatch {
  pdfTopic: string;
  videoTopic: string;
  semanticSimilarity: number;
  lexicalOverlap: number;
  hybridScore: number;
  matchType: ReturnType<typeof classifySimilarity>;
}

function evaluateCandidate(
  score: (semanticSimilarity: number, lexicalOverlap: number) => number,
) {
  const matches: CandidateMatch[] = [];

  for (const [pdfIndex, pdfTopic] of input.pdfTopics.entries()) {
    let bestVideoIndex = 0;
    let bestPair = scoreTopicPair(
      pdfTopic.name,
      input.videoTopics[0].name,
      pdfVectors[pdfIndex],
      videoVectors[0],
    );
    let bestHybridScore = score(
      bestPair.semanticSimilarity,
      bestPair.lexicalOverlap,
    );

    for (
      let videoIndex = 1;
      videoIndex < input.videoTopics.length;
      videoIndex += 1
    ) {
      const pair = scoreTopicPair(
        pdfTopic.name,
        input.videoTopics[videoIndex].name,
        pdfVectors[pdfIndex],
        videoVectors[videoIndex],
      );
      const hybridScore = score(
        pair.semanticSimilarity,
        pair.lexicalOverlap,
      );
      if (hybridScore > bestHybridScore) {
        bestVideoIndex = videoIndex;
        bestPair = pair;
        bestHybridScore = hybridScore;
      }
    }

    matches.push({
      pdfTopic: pdfTopic.name,
      videoTopic: input.videoTopics[bestVideoIndex].name,
      semanticSimilarity: bestPair.semanticSimilarity,
      lexicalOverlap: bestPair.lexicalOverlap,
      hybridScore: bestHybridScore,
      matchType: classifySimilarity(bestHybridScore),
    });
  }

  const distribution = Object.fromEntries(
    ["STRONG", "PARTIAL", "WEAK", "MISSING"].map((matchType) => [
      matchType,
      matches.filter((match) => match.matchType === matchType).length,
    ]),
  );
  const candidateOverallScore =
    (matches.reduce((total, match) => total + match.hybridScore, 0) /
      matches.length) *
    100;

  return { matches, overallScore: candidateOverallScore, distribution };
}

const candidates = {
  "A: 0.75 semantic + 0.25 lexical": evaluateCandidate(
    (semanticSimilarity, lexicalOverlap) =>
      0.75 * semanticSimilarity + 0.25 * lexicalOverlap,
  ),
  "B: 0.70 semantic + 0.30 lexical": evaluateCandidate(
    (semanticSimilarity, lexicalOverlap) =>
      0.7 * semanticSimilarity + 0.3 * lexicalOverlap,
  ),
  "C: semantic × (0.75 + 0.25 lexical)": evaluateCandidate(
    (semanticSimilarity, lexicalOverlap) =>
      semanticSimilarity * (0.75 + 0.25 * lexicalOverlap),
  ),
};

console.log("Candidate formula results");
for (const [candidateName, candidate] of Object.entries(candidates)) {
  console.log(
    JSON.stringify({
      candidate: candidateName,
      overallScore: candidate.overallScore,
      distribution: candidate.distribution,
    }),
  );
}

console.log("\nChosen hybrid matches");
const chosenCandidate = candidates["A: 0.75 semantic + 0.25 lexical"];

console.log(
  JSON.stringify(
    {
      model,
      dimensions,
      geminiRequestCount,
      processingTimeMs,
      overallScore,
      matches: chosenCandidate.matches,
    },
    null,
    2,
  ),
);
