import { NextResponse } from "next/server";

import {
  AnalysisPipelineError,
  runAnalysisPipeline,
} from "@/lib/analysis-pipeline/workflow";

export const runtime = "nodejs";
export const maxDuration = 1800;

interface RouteContext {
  params: Promise<{ id: string }>;
}

function isValidAnalysisId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  if (!isValidAnalysisId(id)) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_ANALYSIS_ID",
          message: "The analysis ID is invalid.",
        },
      },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await runAnalysisPipeline(id));
  } catch (error) {
    if (error instanceof AnalysisPipelineError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode },
      );
    }

    console.error("Analysis pipeline failed.", error);
    return NextResponse.json(
      {
        error: {
          code: "ANALYSIS_PIPELINE_FAILED",
          message:
            "We couldn't complete the analysis. You can retry from where it stopped.",
        },
      },
      { status: 500 },
    );
  }
}
