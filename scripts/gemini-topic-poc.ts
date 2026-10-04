import { readFile } from "node:fs/promises";
import path from "node:path";

import nextEnv from "@next/env";
import { TopicSource } from "@prisma/client";

const [, , sourceArgument, textPathArgument] = process.argv;

if (
  (sourceArgument !== TopicSource.VIDEO && sourceArgument !== TopicSource.PDF) ||
  !textPathArgument
) {
  throw new Error(
    "Usage: gemini-topic-poc.ts <VIDEO|PDF> <path-to-utf8-source-text>",
  );
}

nextEnv.loadEnvConfig(process.cwd());

if (!process.env.GEMINI_API_KEY?.trim()) {
  throw new Error(
    "GEMINI_API_KEY is not configured. Add it to the server environment before running this POC.",
  );
}

const textPath = path.resolve(textPathArgument);
const sourceText = await readFile(textPath, "utf8");
const { createGeminiTopicExtractionClient } = await import(
  "../src/lib/topic-extraction/gemini-client"
);

const startedAt = performance.now();
const result = await createGeminiTopicExtractionClient().extract(
  sourceText,
  sourceArgument,
);

console.log(
  JSON.stringify(
    {
      source: sourceArgument,
      topicCount: result.topics.length,
      processingTimeMs: Math.round(performance.now() - startedAt),
      topics: result.topics,
    },
    null,
    2,
  ),
);
