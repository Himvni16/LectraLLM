import { NextResponse } from "next/server";

import { respondToAnalysisRun } from "@/lib/analysis-pipeline/http";

export const runtime = "nodejs";
export const maxDuration = 300;

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

  return respondToAnalysisRun(id);
}
