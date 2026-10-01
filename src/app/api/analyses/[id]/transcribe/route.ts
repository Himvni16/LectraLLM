import { NextResponse } from "next/server";

import { createAiTranscriptionClient } from "@/lib/transcription/ai-client";
import { createStoredVideoLocator } from "@/lib/transcription/media";
import { prismaTranscriptionRepository } from "@/lib/transcription/repository";
import {
  transcribeAnalysis,
  TranscriptionWorkflowError,
} from "@/lib/transcription/workflow";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const result = await transcribeAnalysis(id, {
      client: createAiTranscriptionClient(),
      repository: prismaTranscriptionRepository,
      videoLocator: createStoredVideoLocator(),
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TranscriptionWorkflowError) {
      if (error.code === "TRANSCRIPTION_FAILED") {
        console.error("Analysis transcription failed.", error.cause);
      }

      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode },
      );
    }

    console.error("Unexpected transcription error.", error);
    return NextResponse.json(
      {
        error: {
          code: "TRANSCRIPTION_FAILED",
          message: "The lecture could not be transcribed.",
        },
      },
      { status: 500 },
    );
  }
}
