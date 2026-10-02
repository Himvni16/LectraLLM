import { NextResponse } from "next/server";

import { createAiTopicComparisonClient } from "@/lib/topic-comparison/ai-client";
import { prismaTopicComparisonRepository } from "@/lib/topic-comparison/repository";
import {
  compareAnalysisTopics,
  TopicComparisonWorkflowError,
} from "@/lib/topic-comparison/workflow";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    return NextResponse.json(
      await compareAnalysisTopics(id, {
        client: createAiTopicComparisonClient(),
        repository: prismaTopicComparisonRepository,
      }),
    );
  } catch (error) {
    if (error instanceof TopicComparisonWorkflowError) {
      if (error.code === "COMPARISON_FAILED") {
        console.error("Analysis topic comparison failed.", error.cause);
      }

      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode },
      );
    }

    console.error("Unexpected topic comparison error.", error);
    return NextResponse.json(
      {
        error: {
          code: "COMPARISON_FAILED",
          message: "Topics could not be compared.",
        },
      },
      { status: 500 },
    );
  }
}
