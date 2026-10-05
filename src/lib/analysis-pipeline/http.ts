import "server-only";

import { NextResponse } from "next/server";

import {
  AnalysisPipelineError,
  runAnalysisPipeline,
} from "@/lib/analysis-pipeline/workflow";

export async function respondToAnalysisRun(analysisId: string) {
  try {
    return NextResponse.json(await runAnalysisPipeline(analysisId));
  } catch (error) {
    if (error instanceof AnalysisPipelineError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.statusCode },
      );
    }

    console.error("Analysis pipeline stage failed.", error);
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
