import { NextResponse } from "next/server";

import { createAiTopicExtractionClient } from "@/lib/topic-extraction/ai-client";
import { prismaTopicExtractionRepository } from "@/lib/topic-extraction/repository";
import {
  extractAnalysisTopics,
  TopicExtractionWorkflowError,
} from "@/lib/topic-extraction/workflow";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const result = await extractAnalysisTopics(id, {
      client: createAiTopicExtractionClient(),
      repository: prismaTopicExtractionRepository,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TopicExtractionWorkflowError) {
      if (error.code === "TOPIC_EXTRACTION_FAILED") {
        console.error("Analysis topic extraction failed.", error.cause);
      }

      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode },
      );
    }

    console.error("Unexpected topic extraction error.", error);
    return NextResponse.json(
      {
        error: {
          code: "TOPIC_EXTRACTION_FAILED",
          message: "Topics could not be extracted.",
        },
      },
      { status: 500 },
    );
  }
}
